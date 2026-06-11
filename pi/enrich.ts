#!/usr/bin/env npx ts-node
// pi/enrich.ts — per-profile enrichment after discover + triage.
//
// For each profile with enrichment.enabled:
//   - validate each active URL still accepts applications (HTTP fetch + string match)
//   - if alumni_network.enabled: scout alumni of the configured school at each
//     company via the Apify google-search-scraper actor
//
// Writes profiles/<name>/.enrichment/state.json which pi/render.ts reads.

import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as yaml from 'js-yaml'
import { callClaude } from './llm'

const ROOT = path.resolve(__dirname, '..')
const QUEUE_PATH = path.join(ROOT, 'jobs', 'queue.md')

interface EnrichmentConfig {
  enabled?: boolean
  validate_listings?: boolean
  alumni_network?: {
    enabled?: boolean
    school?: string
    label?: string
  }
}
interface SearchConfig {
  enrichment?: EnrichmentConfig
}
interface QueueEntry {
  url: string
  profile: string
  title: string
  company: string
}
interface AlumniHit {
  name: string
  snippet: string
  url: string
  verified?: boolean
  verify_reason?: string
}
interface EnrichmentState {
  generated_at: string
  school?: string
  school_label?: string
  listings: Record<string, 'ACTIVE' | 'EXPIRED' | 'UNKNOWN'>
  alumni: Record<string, AlumniHit[]>
}

function parseArgs() {
  return {
    profile: (process.argv.find((a: string) => a.startsWith('--profile=')) || '').split('=')[1] || null,
    skipValidate: process.argv.includes('--skip-validate'),
    skipAlumni: process.argv.includes('--skip-alumni'),
  }
}

function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example')
    .map((d) => d.name)
}

function readConfig(profile: string): SearchConfig | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  return yaml.load(fs.readFileSync(p, 'utf-8')) as SearchConfig
}

function readQueueEntries(profile: string): QueueEntry[] {
  const text = fs.readFileSync(QUEUE_PATH, 'utf-8')
  let inProcessed = false
  const out: QueueEntry[] = []
  for (const raw of text.split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inProcessed = false; continue }
    if (s === '## processed') { inProcessed = true; continue }
    if (inProcessed) continue
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)\s+<!--\s*(.+?)\s+@\s+(.+?)\s*-->/)
    if (!m || m[2] !== profile) continue
    out.push({ url: m[1], profile: m[2], title: m[3], company: m[4] })
  }
  return out
}

function fetchPage(url: string, hops = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 20000,
      },
      (res) => {
        const code = res.statusCode || 0
        if (code >= 300 && code < 400 && res.headers.location && hops < 4) {
          res.resume()
          const next = new URL(res.headers.location, url).toString()
          return resolve(fetchPage(next, hops + 1))
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: code, body: Buffer.concat(chunks).toString('utf-8') }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('fetch timeout')) })
    req.end()
  })
}

async function validateListing(url: string): Promise<'ACTIVE' | 'EXPIRED' | 'UNKNOWN'> {
  try {
    const { status, body } = await fetchPage(url)
    if (status >= 400) return 'UNKNOWN'
    const lower = body.toLowerCase()
    if (lower.includes('no longer accepting applications')) return 'EXPIRED'
    if (lower.includes('this job is no longer')) return 'EXPIRED'
    return 'ACTIVE'
  } catch {
    return 'UNKNOWN'
  }
}

function callApifyGoogleSearch(queries: string[]): Promise<unknown[]> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error('APIFY_TOKEN not set')
  const body = JSON.stringify({
    queries: queries.join('\n'),
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
    languageCode: 'en',
    countryCode: 'us',
  })
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=300`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 320000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          if (res.statusCode && res.statusCode >= 400) return reject(new Error(`apify ${res.statusCode}: ${text.slice(0, 300)}`))
          try { resolve(JSON.parse(text)) } catch (e) { reject(e as Error) }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('apify timeout')) })
    req.write(body)
    req.end()
  })
}

interface OrganicResult { url?: string; title?: string; description?: string }

async function scoutAlumni(companies: string[], school: string): Promise<Record<string, AlumniHit[]>> {
  // Use more specific phrasing in the query to reduce noise.
  const queries = companies.map((c) => `site:linkedin.com/in "at ${c}" "${school}"`)
  const items = await callApifyGoogleSearch(queries)
  const out: Record<string, AlumniHit[]> = {}
  items.forEach((item: unknown, i: number) => {
    const company = companies[i]
    const org = ((item as { organicResults?: OrganicResult[] }).organicResults || []) as OrganicResult[]
    const hits: AlumniHit[] = []
    const seen = new Set<string>()
    for (const r of org.slice(0, 8)) {
      const u = r.url || ''
      if (!u.includes('/in/')) continue
      const canon = u.replace(/\/+$/, '').toLowerCase()
      if (seen.has(canon)) continue
      seen.add(canon)
      const name = (r.title || '').split(' - ')[0].split(' | ')[0].trim()
      hits.push({ name, snippet: (r.title + ' — ' + (r.description || '')).slice(0, 240), url: u })
    }
    out[company] = hits
  })
  return out
}

function callGateway(prompt: string): Promise<string> {
  return callClaude(prompt, { maxTokens: 100, timeoutMs: 30000 })
}

async function verifyHit(hit: AlumniHit, company: string, school: string): Promise<{ verified: boolean; reason: string }> {
  const prompt = `Decide if this LinkedIn search snippet describes a person who is BOTH:
  (a) CURRENTLY employed at "${company}" (not "ex-", "former", or "previously at"), AND
  (b) An alumnus of "${school}" (the actual school, not a person with that last name, not a different "Cornell").

Snippet: "${hit.snippet}"

Output JSON only, no preamble: {"verified": true|false, "reason": "max 8 words"}.

Default to false when uncertain or when the snippet is ambiguous.`

  try {
    const text = await callGateway(prompt)
    const m = text.match(/\{[\s\S]*?\}/)
    if (!m) return { verified: false, reason: 'parse-failed' }
    const d = JSON.parse(m[0])
    return { verified: !!d.verified, reason: String(d.reason || '').slice(0, 60) }
  } catch (e) {
    return { verified: false, reason: 'verify-error' }
  }
}

async function verifyAllAlumni(alumni: Record<string, AlumniHit[]>, school: string): Promise<void> {
  for (const [company, hits] of Object.entries(alumni)) {
    if (hits.length === 0) continue
    const results = await Promise.all(hits.map((h) => verifyHit(h, company, school)))
    results.forEach((r, i) => {
      hits[i].verified = r.verified
      hits[i].verify_reason = r.reason
    })
    const ok = results.filter((r) => r.verified).length
    console.log(`    ${company}: ${ok}/${hits.length} verified`)
  }
}

async function enrichProfile(profile: string, opts: ReturnType<typeof parseArgs>): Promise<void> {
  const config = readConfig(profile)
  const enr = config?.enrichment
  if (!enr?.enabled) {
    console.log(`  ${profile}: enrichment disabled — skipping`)
    return
  }
  const entries = readQueueEntries(profile)
  if (entries.length === 0) {
    console.log(`  ${profile}: no queued entries to enrich`)
    return
  }
  console.log(`  ${profile}: enriching ${entries.length} entries...`)

  const state: EnrichmentState = {
    generated_at: new Date().toISOString(),
    listings: {},
    alumni: {},
  }

  // Listings validation
  if (enr.validate_listings && !opts.skipValidate) {
    console.log(`  ${profile}: validating listings...`)
    let active = 0, expired = 0, unknown = 0
    for (const e of entries) {
      const verdict = await validateListing(e.url)
      state.listings[e.url] = verdict
      if (verdict === 'ACTIVE') active++
      else if (verdict === 'EXPIRED') expired++
      else unknown++
    }
    console.log(`  ${profile}: ${active} active, ${expired} expired, ${unknown} unknown`)
  }

  // Alumni link — no auto-scrape (too noisy). Render generates one deep-link per
  // company straight into the user's authed LinkedIn session, which shows real
  // verified data without us paying Apify or guessing names.
  if (enr.alumni_network?.enabled && !opts.skipAlumni) {
    // No school configured = no alumni deep-links for this profile; everything
    // else (listings validation, state.json) still proceeds normally.
    const school = enr.alumni_network.school || ''
    if (school) {
      state.school = school
      state.school_label = enr.alumni_network.label || school
      console.log(`  ${profile}: alumni links will deep-link to LinkedIn search for "${school}"`)
    }
  }

  const dir = path.join(ROOT, 'profiles', profile, '.enrichment')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2))
  console.log(`  ${profile}: wrote profiles/${profile}/.enrichment/state.json`)
}

async function main() {
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  if (profiles.length === 0) {
    console.log('No profiles found.')
    return
  }
  console.log(`Enriching ${profiles.length} profile(s)...\n`)
  for (const p of profiles) {
    await enrichProfile(p, opts)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
