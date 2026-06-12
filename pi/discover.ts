#!/usr/bin/env npx ts-node
// pi/discover.ts — Apify LinkedIn Jobs → jobs/queue.md
//
// Runs on ve-code via Pi cron. For each profiles/<name>/search.yaml,
// calls an Apify LinkedIn Jobs actor, dedupes against the queue and
// the profile's applications.md, and appends new URLs tagged with
// the profile name.
//
// On --commit, opens a PR via gh CLI and (optionally) pings Telegram.

import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as child_process from 'child_process'
import * as yaml from 'js-yaml'
import { atsDiscover, AtsJob } from './sources/ats'
import { runActorSync, apifyAvailable } from './apify'
import { exaDiscover } from './sources/exa'

const ROOT = path.resolve(__dirname, '..')
const QUEUE_PATH = path.join(ROOT, 'jobs', 'queue.md')
const WATCHLIST_CAP = 30

interface SearchConfig {
  keywords: string[]
  locations: string[]
  posted_within_days?: number
  experience_levels?: string[]
  exclude_companies?: string[]
  exclude_keywords?: string[]
  max_results?: number
}

interface JobResult {
  url: string
  title: string
  company: string
  location: string
  posted: string | null
}

interface DiscoverOptions {
  profile: string | null
  dryRun: boolean
  commit: boolean
}

function parseArgs(): DiscoverOptions {
  const args = process.argv.slice(2)
  const profileArg = args.find((a: string) => a.startsWith('--profile='))
  return {
    profile: profileArg ? profileArg.split('=')[1] : null,
    dryRun: args.includes('--dry-run'),
    commit: args.includes('--commit'),
  }
}

function listProfiles(): string[] {
  const dir = path.join(ROOT, 'profiles')
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example')
    .map((d) => d.name)
}

function readSearchConfig(profile: string): SearchConfig | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, 'utf-8')
  return yaml.load(raw) as SearchConfig
}

// Keywords + Haiku expansions (pi/expand-keywords.ts). The ATS and Exa sources
// search the widened set; Apify keeps the human's originals (its URL list is
// capped and the originals are the true intent).
function expandedKeywords(profile: string, config: SearchConfig): string[] {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'keywords.json')
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return [...config.keywords, ...(Array.isArray(d.expansions) ? d.expansions : [])]
  } catch { return config.keywords }
}

// ATS watchlist for a profile: manual companies.yaml, companies already kept in
// the queue (we applied or shortlisted there once — watch their whole board),
// and companies where the alumni pass found warm contacts (network-first:
// a warm intro makes EVERY opening at that company worth seeing).
function buildWatchlist(profile: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (name: string) => {
    const key = name.toLowerCase().trim()
    if (key && !seen.has(key)) { seen.add(key); out.push(name.trim()) }
  }
  const manual = path.join(ROOT, 'profiles', profile, 'companies.yaml')
  if (fs.existsSync(manual)) {
    try {
      const d = yaml.load(fs.readFileSync(manual, 'utf-8')) as { companies?: string[] }
      ;(d.companies || []).forEach(add)
    } catch { /* malformed manual list — fall through to auto sources */ }
  }
  const alumni = path.join(ROOT, 'profiles', profile, '.enrichment', 'alumni.json')
  try {
    const d = JSON.parse(fs.readFileSync(alumni, 'utf-8'))
    Object.keys(d.by_company || {}).forEach(add)
  } catch { /* no alumni data yet */ }
  if (fs.existsSync(QUEUE_PATH)) {
    let inQueue = false
    for (const raw of fs.readFileSync(QUEUE_PATH, 'utf-8').split('\n')) {
      const s = raw.trim().toLowerCase()
      if (s === '## queue') { inQueue = true; continue }
      if (s === '## processed') { inQueue = false; continue }
      if (!inQueue) continue
      const m = raw.match(/\|\s*profile=(\S+)\s+<!--\s*.+?\s+@\s+(.+?)\s*-->/)
      if (m && m[1] === profile) add(m[2])
    }
  }
  return out.slice(0, WATCHLIST_CAP)
}

// Canonical URL for dedup. Denylist tracking params (preserves Workday-style
// ?jobId=, which IS the canonical id), lowercase host, strip www, strip trailing
// slash, collapse LinkedIn collection paths to /jobs/view/<id>.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'refid', 'trk', 'trkinfo', 'trackingid',
  'lever-source', 'leversource', 'gh_src', 'src', 'source',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'msclkid',
  // LinkedIn search-result junk:
  'position', 'pagenum', 'eblsubscribed', 'origintoken', 'savedsearchid',
])

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return trimmed.toLowerCase()
  }

  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  u.hash = ''

  // LinkedIn collection-style URL → canonical /jobs/view/<id>
  if (u.hostname.endsWith('linkedin.com')) {
    const currentJobId = u.searchParams.get('currentJobId')
    if (currentJobId && /^\d+$/.test(currentJobId)) {
      u.pathname = `/jobs/view/${currentJobId}`
      u.search = ''
    }
  }

  for (const key of Array.from(u.searchParams.keys())) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) u.searchParams.delete(key)
  }

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)

  return u.toString()
}

function loadExistingUrls(profile: string): Set<string> {
  const urls = new Set<string>()
  if (fs.existsSync(QUEUE_PATH)) {
    for (const line of fs.readFileSync(QUEUE_PATH, 'utf-8').split('\n')) {
      const m = line.match(/^(https?:\/\/\S+)/)
      if (m) urls.add(normalizeUrl(m[1]))
    }
  }
  const appsPath = path.join(ROOT, 'profiles', profile, 'applications.md')
  if (fs.existsSync(appsPath)) {
    for (const line of fs.readFileSync(appsPath, 'utf-8').split('\n')) {
      const m = line.match(/\*\*URL:\*\*\s+(https?:\/\/\S+)/)
      if (m) urls.add(normalizeUrl(m[1]))
    }
  }
  return urls
}

const EXPERIENCE_CODES: Record<string, string> = {
  internship: '1',
  entry: '2',
  'entry level': '2',
  associate: '3',
  'mid-senior': '4',
  'mid senior level': '4',
  director: '5',
  executive: '6',
}

function buildLinkedInUrls(config: SearchConfig): string[] {
  const codes = (config.experience_levels || [])
    .map((l) => EXPERIENCE_CODES[l.toLowerCase()] || '')
    .filter(Boolean)
    .join(',')
  const tpr = `r${(config.posted_within_days || 7) * 86400}`
  const urls: string[] = []
  for (const keyword of config.keywords) {
    for (const location of config.locations) {
      const p = new URLSearchParams({ keywords: keyword, location, f_TPR: tpr })
      if (codes) p.set('f_E', codes)
      urls.push(`https://www.linkedin.com/jobs/search/?${p.toString()}`)
    }
  }
  return urls.slice(0, 10)
}

async function callApify(config: SearchConfig): Promise<JobResult[]> {
  const actor = (process.env.APIFY_LINKEDIN_ACTOR || 'curious_coder~linkedin-jobs-scraper').replace('/', '~')
  if (!apifyAvailable()) throw new Error('no APIFY_TOKEN configured')
  const raw = await runActorSync(actor, {
    urls: buildLinkedInUrls(config),
    count: config.max_results || 30,
    scrapeCompany: false,
  }, 240000)
  if (raw === null) throw new Error('apify run failed (see log above)')
  const items: JobResult[] = (raw as Record<string, unknown>[]).map((r) => ({
    url: String(r.url || r.jobUrl || r.link || ''),
    title: String(r.title || r.jobTitle || ''),
    company: String(r.companyName || r.company || ''),
    location: String(r.location || r.jobLocation || ''),
    posted: (r.postedAt as string) || (r.publishedAt as string) || null,
  }))
  return items.filter((j) => j.url.startsWith('http'))
}

function applyExcludeFilters(jobs: JobResult[], config: SearchConfig): { kept: JobResult[]; dropped: number } {
  const excludeCompanies = new Set((config.exclude_companies || []).map((s) => s.toLowerCase()))
  const excludeKeywords = (config.exclude_keywords || []).map((s) => s.toLowerCase())
  let dropped = 0
  const kept = jobs.filter((j) => {
    if (excludeCompanies.has(j.company.toLowerCase())) {
      dropped++
      return false
    }
    const blob = `${j.title} ${j.company}`.toLowerCase()
    if (excludeKeywords.some((k) => blob.includes(k))) {
      dropped++
      return false
    }
    return true
  })
  return { kept, dropped }
}

function appendToQueue(entries: { url: string; profile: string; meta: JobResult }[]): void {
  if (entries.length === 0) return
  const lines = fs.readFileSync(QUEUE_PATH, 'utf-8').split('\n')
  const queueIdx = lines.findIndex((l) => l.trim().toLowerCase() === '## queue')
  if (queueIdx === -1) throw new Error('Could not find "## Queue" header in jobs/queue.md')
  const today = new Date().toISOString().slice(0, 10)
  const block = [
    '',
    `<!-- auto-discovered ${today} -->`,
    ...entries.map((e) => `${e.url} | profile=${e.profile}  <!-- ${e.meta.title} @ ${e.meta.company} -->`),
  ]
  lines.splice(queueIdx + 1, 0, ...block)
  fs.writeFileSync(QUEUE_PATH, lines.join('\n'))
}

function notifyTelegram(text: string): void {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  const req = https.request(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
    (res) => res.resume(),
  )
  req.on('error', (e) => console.error('Telegram error:', e.message))
  req.write(body)
  req.end()
}

function commitAndOpenPr(summary: string): void {
  const branch = `auto/discover-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-4)}`
  child_process.execSync(`git -C "${ROOT}" checkout -b ${branch}`, { stdio: 'inherit' })
  child_process.execSync(`git -C "${ROOT}" add jobs/queue.md`, { stdio: 'inherit' })
  child_process.execSync(
    `git -C "${ROOT}" -c user.name=pi-discover -c user.email=pi@ve-code.exe.xyz commit -m "auto-discover: ${summary}"`,
    { stdio: 'inherit' },
  )
  child_process.execSync(`git -C "${ROOT}" push -u origin ${branch}`, { stdio: 'inherit' })
  child_process.execSync(
    `gh pr create --repo collectivewinca/ve-work --title "auto-discover: ${summary}" --body "Pi discovery cron run on $(date -u +%F). Review the additions and merge if good."`,
    { stdio: 'inherit', cwd: ROOT },
  )
}

async function main(): Promise<void> {
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  if (profiles.length === 0) {
    console.log('No profiles found.')
    return
  }

  const allNew: { url: string; profile: string; meta: JobResult }[] = []
  const perProfile: Record<string, { found: number; new: number; dropped: number }> = {}

  for (const profile of profiles) {
    const config = readSearchConfig(profile)
    if (!config) {
      console.log(`  ${profile}: no search.yaml — skipping`)
      continue
    }
    console.log(`  ${profile}: searching ${config.keywords.join(', ')} in ${config.locations.join(', ')}...`)
    const jobs: JobResult[] = []
    // Source 1 — Apify LinkedIn (original keywords). A failure here no longer
    // kills the profile's whole run; the direct sources still report.
    if (!opts.dryRun) {
      try {
        jobs.push(...(await callApify(config)))
      } catch (e) {
        console.error(`  ${profile}: Apify failed — ${(e as Error).message}`)
      }
    }
    const wide = expandedKeywords(profile, config)
    // Source 2 — direct ATS boards for the profile's watchlist.
    if (!opts.dryRun) {
      try {
        const watchlist = buildWatchlist(profile)
        const r = await atsDiscover(watchlist, wide, config.locations)
        console.log(`  ${profile}: ats — ${r.jobs.length} matching role(s) from ${r.resolved} board(s) (${r.missed} companies unresolved)`)
        jobs.push(...r.jobs.map((j: AtsJob) => ({ url: j.url, title: j.title, company: j.company, location: j.location, posted: j.posted })))
      } catch (e) {
        console.error(`  ${profile}: ats failed — ${(e as Error).message}`)
      }
    }
    // Source 3 — Exa neural search over ATS domains (expanded keywords).
    if (!opts.dryRun) {
      try {
        const exaJobs = await exaDiscover(wide, config.locations, 15)
        console.log(`  ${profile}: exa — ${exaJobs.length} role(s)`)
        jobs.push(...exaJobs.map((j) => ({ url: j.url, title: j.title, company: j.company, location: j.location, posted: j.posted })))
      } catch (e) {
        console.error(`  ${profile}: exa failed — ${(e as Error).message}`)
      }
    }
    const { kept, dropped } = applyExcludeFilters(jobs, config)
    const existing = loadExistingUrls(profile)
    // Dedup against the queue AND within this batch — the ATS and Exa sources
    // routinely surface the same posting URL.
    const batchSeen = new Set<string>()
    const fresh = kept.filter((j) => {
      const key = normalizeUrl(j.url)
      if (existing.has(key) || batchSeen.has(key)) return false
      batchSeen.add(key)
      return true
    })
    perProfile[profile] = { found: jobs.length, new: fresh.length, dropped }
    fresh.forEach((meta) => allNew.push({ url: meta.url, profile, meta }))
    console.log(`  ${profile}: ${jobs.length} found, ${dropped} excluded, ${fresh.length} new after dedup`)
  }

  if (allNew.length === 0) {
    console.log('\nNothing new across any profile.')
    return
  }

  if (opts.dryRun) {
    console.log(`\n[DRY RUN] Would append ${allNew.length} URL(s):`)
    allNew.forEach((e) => console.log(`  [${e.profile}] ${e.url}  (${e.meta.title} @ ${e.meta.company})`))
    return
  }

  appendToQueue(allNew)
  const summary = Object.entries(perProfile)
    .filter(([, s]) => s.new > 0)
    .map(([p, s]) => `${s.new} for ${p}`)
    .join(', ')
  console.log(`\nAppended to jobs/queue.md: ${summary}`)

  if (opts.commit) {
    commitAndOpenPr(summary)
  }

  notifyTelegram(`*ve-work auto-discover*\n${summary}\n\nReview the queue or the PR before tailoring.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
