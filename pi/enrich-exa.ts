#!/usr/bin/env npx ts-node
// pi/enrich-exa.ts — Per-profile Exa enrichment for the dashboard's "Other sources"
// and alumni recommendation tabs. Runs in the daily cron (ship.sh) before render.
//
// Writes:
//   profiles/<name>/external.json            — roles found OUTSIDE LinkedIn (ATS/careers)
//   profiles/<name>/.enrichment/alumni.json  — ranked warm-intro recommendations
//
// Deterministic: Exa does the people/role discovery + per-result fact summary; this
// script parses those facts (school degree/years => confirmed, title seniority =>
// relevance) and templates a reason + intro angle. Hand-curation beats it, but this
// keeps every profile auto-refreshed daily. No-op without EXA_API_KEY.

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const ROOT = path.resolve(__dirname, '..')
const QUEUE = path.join(ROOT, 'jobs', 'queue.md')
const EXA_KEY = (process.env.EXA_API_KEY || '').trim()
const ATS = [
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co',
  'myworkdayjobs.com', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com', 'icims.com',
]
// Skip alumni lookups at obvious staffing/recruiting "companies" (hidden employer).
const RECRUITER = /cybercoders|w3global|metric geo|kos international|jobgether|robert half|staffing|recruit|talent group|talent solutions/i

type Relevance = 'high' | 'medium' | 'low'
type PathKind = 'alumni' | 'ex-colleague'
interface Search {
  keywords?: string[]; locations?: string[]
  enrichment?: { alumni_network?: { school?: string; label?: string; enabled?: boolean } }
}
interface Rec {
  name: string; url: string; title?: string; cornell?: string
  confirmed: boolean; relevance: Relevance; reason?: string; intro_angle?: string
  path?: PathKind; via?: string // which school/company makes this a warm path
  verified?: boolean // true = education/experience checked on the REAL LinkedIn profile (Apify)
}
interface Graph { schools: { name: string }[]; employers: { name: string; current: boolean }[] }

// Warm-path anchors come from the candidate's REAL history (pi/profile-graph.ts),
// with search.yaml's alumni_network.school kept as an extra manual anchor.
function readGraph(profile: string): Graph {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'graph.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return { schools: [], employers: [] } }
}

function parseArgs() {
  return { profile: (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] || null }
}
function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example').map((d) => d.name)
}
function readSearch(profile: string): Search | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  try { return yaml.load(fs.readFileSync(p, 'utf-8')) as Search } catch { return null }
}
function keptCompanies(profile: string): string[] {
  if (!fs.existsSync(QUEUE)) return []
  const text = fs.readFileSync(QUEUE, 'utf-8')
  let inQueue = false
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inQueue = true; continue }
    if (s === '## processed') { inQueue = false; continue }
    if (!inQueue) continue
    const m = raw.match(/\|\s*profile=(\S+)\s+<!--\s*.+?\s+@\s+(.+?)\s*-->/)
    if (!m || m[1] !== profile) continue
    const co = m[2].trim()
    if (RECRUITER.test(co)) continue
    // Garbage "company" names from Exa-sourced queue comments ("Pinecone - Jobs
    // @ jobs.ashbyhq.com") produce garbage people searches — skip them.
    if (/@|https?:|\bjobs?\b|\.(com|io|ai|co|org)\b|\(| [-—] /i.test(co) || co.length > 35) continue
    const key = co.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(co) }
  }
  return out
}

async function exa(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.exa.ai/' + endpoint, {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as Record<string, unknown>
}

function boardName(host: string): string {
  if (/greenhouse/.test(host)) return 'Greenhouse'
  if (/lever/.test(host)) return 'Lever'
  if (/myworkday|workday/.test(host)) return 'Workday'
  if (/ashby/.test(host)) return 'Ashby'
  if (/smartrecruiters/.test(host)) return 'SmartRecruiters'
  if (/icims/.test(host)) return 'iCIMS'
  return 'Company careers'
}
function titleRelevance(title: string): Relevance {
  const t = title.toLowerCase()
  if (/\b(head|chief|cpo|vp|vice president|evp|svp|director|principal|partner|owner)\b/.test(t)) return 'high'
  if (/\b(senior|sr\.?|lead|staff|manager|superintendent)\b/.test(t)) return 'medium'
  return 'low'
}
// The school's most DISTINCTIVE token — never a generic word. "University of
// Pune" must key on "pune", not "university" (which matches every profile and
// produced confirmed-but-wrong alumni).
const GENERIC = new Set(['university', 'institute', 'college', 'school', 'of', 'the', 'management', 'technology', 'state'])
function distinctiveToken(name: string): string {
  const words = (name || '').toLowerCase().split(',')[0].split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w))
  return words[0] || ''
}

function schoolConfirmed(summary: string, school: string): boolean {
  const s = summary.toLowerCase()
  const key = distinctiveToken(school)
  if (!key || !s.includes(key)) return false
  // Exa often ECHOES the school we asked about ("Welingkar: not shown") — any
  // not-shown/not-listed phrasing anywhere in the summary kills the confirm.
  if (/\bnot (shown|visible|indicated|listed|mentioned|found)\b|\bno (school|education)\b|unconfirmed/.test(s)) return false
  const i = s.indexOf(key)
  const near = s.slice(Math.max(0, i - 40), i + 90)
  const degree = /\b(mba|m\.?eng|m\.?s|mme|ph\.?d|b\.?s|b\.?a|b\.?eng|bachelor|master|degree|attended|diploma)\b/.test(near)
  const years = /\b(19|20)\d{2}\b/.test(near)
  return degree || years
}
// Pull a concise "Title @ co" and "School ..." back out of Exa's labelled summary.
function field(summary: string, label: RegExp): string | undefined {
  const m = summary.match(label)
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 120) : undefined
}

// Derive a clean {title, company} from Exa's role summary — the line we queried
// for "exact job title, hiring company, location". This is the SOURCE OF TRUTH
// for the title: ATS pages often ship broken <title> tags (e.g. a literal
// "page_title" placeholder), so res.title is only a last-resort fallback.
// Delimiter order matters: explicit "Hiring company:" labels, then " at ", then
// " — ", and only then a comma (which lives inside titles like "Vice President,
// Enterprise Master Planning").
function fromSummary(summary: string): { title?: string; company?: string } {
  const s = (summary || '').replace(/\s+/g, ' ').trim()
  let title: string | undefined
  let company: string | undefined
  const coLabel = s.match(/hiring\s+(?:company|by)[:\s]+([^;.\n)]+)/i)
  if (coLabel) company = coLabel[1].trim()
  const tLabel = s.match(/(?:exact\s+)?job\s+title[:\s]+(.+?)(?:\s*;|\s+hiring|$)/i)
  if (tLabel) title = tLabel[1].trim()
  if (!title) {
    let head = s
    if (company && coLabel && coLabel.index !== undefined) {
      head = s.slice(0, coLabel.index).replace(/[;,\s—–-]+$/, '')
    }
    if (company) {
      title = head.trim()
      const c = title.indexOf(',')
      if (c > 0) {
        const after = title.slice(c + 1)
        if (after.includes('(') || after.toLowerCase().includes(company.toLowerCase())) {
          title = title.slice(0, c).trim()
        }
      }
    } else {
      const at = head.match(/^(.+?)\s+at\s+(.+)$/i)
      const dash = head.match(/^(.+?)\s+[—–]\s+(.+)$/)
      if (at) { title = at[1].trim(); company = at[2] }
      else if (dash) { title = dash[1].trim(); company = dash[2] }
      else { const c = head.indexOf(','); title = (c > 0 ? head.slice(0, c) : head).trim(); company = c > 0 ? head.slice(c + 1) : undefined }
    }
  }
  if (title) title = title.replace(/[(,;—–\-\s]+$/, '').trim()
  if (company) {
    company = company.replace(/\s+[—–-]\s+.*$/, '').split(',')[0].replace(/\s*\(.*$/, '').replace(/[).;:\s]+$/, '').trim()
  }
  return { title: title || undefined, company: company || undefined }
}

function isJunkTitle(t: string): boolean {
  return !t || /^(page_title|\d+|role)$/i.test(t) || t.length < 3
}

async function externalRoles(s: Search): Promise<unknown[]> {
  const kw = (s.keywords || []).slice(0, 3).map((k) => `"${k}"`).join(' OR ') || 'product manager'
  const loc = (s.locations || ['Remote']).join(' ')
  const r = await exa('search', {
    query: `${kw} job opening ${loc}`, numResults: 10, type: 'auto', includeDomains: ATS,
    contents: { summary: { query: 'Exact job title, hiring company, and location (city/remote). One short line.' } },
  })
  const results = (r.results as Record<string, string>[]) || []
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const res of results) {
    const url = res.url
    if (!url || seen.has(url)) continue
    seen.add(url)
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'web' } })()
    const summary = (res.summary || '').replace(/\s+/g, ' ').trim()
    const ex = fromSummary(summary)
    const rawTitle = (res.title || '').replace(/\s*\|.*$/, '').trim()
    out.push({
      url,
      // Prefer the title Exa extracted from the page body; the raw <title> tag is
      // a fallback and only used when it isn't obvious junk.
      title: ex.title || (isJunkTitle(rawTitle) ? 'Role' : rawTitle),
      company: ex.company || field(summary, /company[:\s]+([^.;,]+)/i) || host,
      source: boardName(host),
      location: field(summary, /(?:location|in)[:\s]+([A-Za-z ,]+(?:remote|NY|CA|NYC)[A-Za-z ,]*)/i) || undefined,
      note: summary.slice(0, 150) || undefined,
    })
    if (out.length >= 8) break
  }
  return out
}

// Ex-colleague paths: people who left one of the candidate's past companies for
// the target company. Same Exa shape as the alumni pass; "confirmed" means the
// summary actually shows the past-company stint (years or an explicit mention).
async function exColleaguesFor(company: string, pastCo: string, kw: string): Promise<Rec[]> {
  const r = await exa('search', {
    query: `worked at ${pastCo} now at ${company} ${kw}`, category: 'linkedin profile', numResults: 4, type: 'auto',
    contents: { summary: { query: `TITLE: exact current job title (confirm at ${company}). PAST: did they previously work at ${pastCo}? years if shown, else 'not shown'.` } },
  })
  const results = (r.results as Record<string, string>[]) || []
  const recs: Rec[] = []
  for (const res of results) {
    const summary = (res.summary || '').replace(/\s+/g, ' ').trim()
    const title = field(summary, /title[:\s]+([^|]+?)(?:\s*\||$)/i) || ''
    const past = field(summary, /past[:\s]+([^|]+?)(?:\s*\||$)/i) || ''
    // Exa happily returns people FROM the past company who never moved to the
    // target — if the extracted title names a current employer, it must be the
    // target company or the person is useless as a warm path there.
    const atOther = title.match(/\bat\s+([A-Za-z0-9&.\- ]{2,40})/i)
    if (atOther && !new RegExp(company.split(/\s+/)[0].replace(/[^\w]/g, ''), 'i').test(atOther[1])) continue
    const confirmed = new RegExp(pastCo.split(/\s+/)[0].replace(/[^\w]/g, ''), 'i').test(past) && !/not (shown|mentioned|listed)/i.test(past)
    if (!confirmed) continue // unverifiable overlap = noise, not a warm path
    const relevance = titleRelevance(title)
    recs.push({
      name: (res.title || '').split(' - ')[0].split(' | ')[0].trim(),
      url: res.url,
      title: title || undefined,
      confirmed,
      relevance,
      path: 'ex-colleague',
      via: pastCo,
      reason: confirmed
        ? `Ex-${pastCo} — now at ${company}. Shared-employer warm path.`
        : `Relevant role at ${company}; ${pastCo} overlap unconfirmed — treat as a role contact.`,
      intro_angle: confirmed
        ? `Open with the shared ${pastCo} chapter; ask what the move to ${company} was like, then about the open role.`
        : `Role-based outreach referencing the posting.`,
    })
  }
  return recs
}

async function alumniFor(company: string, school: string, label: string, kw: string): Promise<Rec[]> {
  const r = await exa('search', {
    query: `${school} alumni at ${company} ${kw}`, category: 'linkedin profile', numResults: 4, type: 'auto',
    contents: { summary: { query: `TITLE: exact current job title (confirm at ${company}). SCHOOL: did they attend ${school}? degree and years, else 'not shown'.` } },
  })
  const results = (r.results as Record<string, string>[]) || []
  const recs: Rec[] = []
  for (const res of results) {
    const summary = (res.summary || '').replace(/\s+/g, ' ').trim()
    const title = field(summary, /title[:\s]+([^|]+?)(?:\s*\||$)/i) || ''
    // Must actually be AT the target company: if the title names a different
    // current employer ("Proprietor at Hotel Majestic" under Pagaya), drop it.
    const atOther = (title + ' ' + summary.slice(0, 120)).match(/\bat\s+([A-Za-z0-9&.\- ]{2,40})/i)
    const coKey = company.toLowerCase().split(/\s+/)[0].replace(/[^\w]/g, '')
    if (atOther && coKey && !atOther[1].toLowerCase().replace(/[^\w ]/g, '').includes(coKey)) continue
    const confirmed = schoolConfirmed(summary, school)
    if (!confirmed) continue // unconfirmed ties are noise, not leads
    const relevance = titleRelevance(title)
    const single = label.replace(/s$/, '')
    recs.push({
      name: (res.title || '').split(' - ')[0].split(' | ')[0].trim(),
      url: res.url,
      title: title || undefined,
      cornell: confirmed ? (field(summary, /school[:\s]+([^|]+?)(?:\s*\||$)/i) || `${school} (confirmed)`) : `${school} tie not shown`,
      confirmed,
      relevance,
      reason: confirmed
        ? `${relevance === 'high' ? 'Senior' : 'Peer-level'} ${single} at ${company} — a warm-intro target.`
        : `Relevant role at ${company}, but ${label} tie unconfirmed — treat as a role contact.`,
      intro_angle: confirmed
        ? `Lead with the ${school} connection; ask about openings on the team.`
        : `Role-based outreach referencing the posting; no ${label} angle.`,
    })
  }
  const score = (x: Rec) => (x.confirmed ? 3 : 0) + ({ high: 2, medium: 1, low: 0 }[x.relevance])
  return recs.sort((a, b) => score(b) - score(a)).slice(0, 3)
}

// ── LinkedIn ground-truth verification (Apify, optional) ────────────────────
// Exa summaries are hearsay; the profile page is the record. When APIFY_TOKEN
// is set, each top rec's REAL LinkedIn profile is scraped (apimaestro/
// linkedin-profile-detail, ~$0.005/profile, no cookies) and we require:
//   alumni       → the school's distinctive token appears in their EDUCATION
//   ex-colleague → the past company appears in their EXPERIENCE
//   both         → the target company appears in their EXPERIENCE
// Verdicts are cached per (url, company) in .enrichment/people-verified.json,
// so re-runs are free. Without a token this layer is skipped (Exa rules only).
import { runActorSync, apifyAvailable } from './apify'
const VERIFY_CAP = 12 // max NEW profile scrapes per profile per run (cost guard)

interface VerifyCache { [key: string]: { ok: boolean; at: string } }
function verifyCachePath(profile: string): string {
  return path.join(ROOT, 'profiles', profile, '.enrichment', 'people-verified.json')
}

async function fetchLinkedInProfile(url: string): Promise<string | null> {
  const items = await runActorSync('apimaestro~linkedin-profile-detail', { username: url, includeEmail: false })
  if (!items || !items[0]) return null
  return JSON.stringify(items[0]).toLowerCase()
}

function sectionBlob(profileJson: string, keys: string[]): string {
  // Pull the named array sections out of the raw profile JSON (schema-tolerant:
  // actors rename fields; we match any key that CONTAINS the section name).
  try {
    const d = JSON.parse(profileJson) as Record<string, unknown>
    const blobs: string[] = []
    for (const [k, v] of Object.entries(d)) {
      if (keys.some((key) => k.toLowerCase().includes(key))) blobs.push(JSON.stringify(v).toLowerCase())
    }
    return blobs.join(' ') || profileJson // fall back to whole profile if sections not found
  } catch { return profileJson }
}

// A company's DISTINCTIVE tokens (drop corp suffixes), ALL of which must appear
// for a match — so "Turner & Townsend" needs both "turner" AND "townsend",
// rejecting "Turner Construction Company".
const CORP = new Set(['inc', 'llc', 'ltd', 'corp', 'co', 'company', 'group', 'technologies', 'technology', 'holdings', 'partners', 'llp', 'plc', 'and'])
function companyTokens(name: string): string[] {
  return (name || '').toLowerCase().replace(/&/g, ' and ').split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ''))
    .filter((w) => w.length > 2 && !CORP.has(w))
}
function blobHasAllCompanyTokens(blob: string, name: string): boolean {
  const toks = companyTokens(name)
  return toks.length === 0 ? true : toks.every((t) => blob.includes(t))
}

// The candidate's CURRENT employer only — headline + experience entries that are
// current (no end date / marked current), falling back to the most-recent entry.
// Prevents an OLD position at the target company from passing someone who has
// since moved elsewhere.
function currentCompanyBlob(profileJson: string): string {
  try {
    const d = JSON.parse(profileJson) as Record<string, unknown>
    const parts: string[] = []
    const bi = (d.basic_info || {}) as Record<string, unknown>
    const headline = bi.headline || d.headline
    if (headline) parts.push(String(headline).toLowerCase())
    for (const [k, v] of Object.entries(d)) {
      if (/experience|position/i.test(k) && Array.isArray(v)) {
        const arr = v as Record<string, unknown>[]
        const current = arr.filter((e) => {
          const end = e.end_date ?? e.endDate ?? e.ends_at ?? e.end
          const cur = e.is_current ?? e.current
          return cur === true || end == null || end === '' || /present|current/i.test(JSON.stringify(end))
        })
        const take = current.length ? current : arr.slice(0, 1)
        parts.push(JSON.stringify(take).toLowerCase())
      }
    }
    return parts.join(' ') || profileJson
  } catch { return profileJson }
}

async function verifyRecs(profile: string, company: string, recs: Rec[]): Promise<Rec[]> {
  if (!apifyAvailable()) return recs
  let cache: VerifyCache = {}
  try { cache = JSON.parse(fs.readFileSync(verifyCachePath(profile), 'utf-8')) } catch { /* first run */ }
  let scrapes = 0
  const out: Rec[] = []
  for (const r of recs) {
    if (!/linkedin\.com\/in\//i.test(r.url)) { out.push(r); continue } // can't verify non-profile URLs
    const key = `${r.url.toLowerCase()}|${company.toLowerCase()}`
    let verdict = cache[key]
    if (!verdict && scrapes < VERIFY_CAP) {
      scrapes++
      const pj = await fetchLinkedInProfile(r.url)
      if (pj === null) { out.push(r); continue } // scrape failed — keep Exa verdict, unverified
      // CURRENT employer must match ALL distinctive company tokens (was a loose
      // first-word substring over the whole history — passed "Turner
      // Construction" for "Turner & Townsend", and people who'd since left).
      const atCompany = blobHasAllCompanyTokens(currentCompanyBlob(pj), company)
      const tieOk = r.path === 'ex-colleague'
        ? blobHasAllCompanyTokens(sectionBlob(pj, ['experience', 'position']), r.via || '')
        : sectionBlob(pj, ['education']).includes(distinctiveToken(r.via || ''))
      verdict = { ok: atCompany && tieOk, at: new Date().toISOString().slice(0, 10) }
      cache[key] = verdict
    }
    if (!verdict) { out.push(r); continue } // cap reached — keep, unverified
    if (verdict.ok) out.push({ ...r, verified: true })
    // verdict.ok === false → silently dropped: the profile itself contradicts the tie
  }
  fs.mkdirSync(path.dirname(verifyCachePath(profile)), { recursive: true })
  fs.writeFileSync(verifyCachePath(profile), JSON.stringify(cache, null, 2))
  return out
}

async function enrichProfile(profile: string): Promise<void> {
  const s = readSearch(profile)
  if (!s) { console.log(`  ${profile}: no search.yaml — skip`); return }
  const dir = path.join(ROOT, 'profiles', profile)
  // A profile with a `.curated` marker has hand-authored external.json / alumni.json
  // (richer reasons + intro angles). Never clobber it with the templated version.
  if (fs.existsSync(path.join(dir, '.curated'))) {
    console.log(`  ${profile}: .curated — keeping hand-authored data, skipping`)
    return
  }
  // External roles
  try {
    const ext = await externalRoles(s)
    fs.writeFileSync(path.join(dir, 'external.json'), JSON.stringify(ext, null, 2))
    console.log(`  ${profile}: external.json — ${ext.length} non-LinkedIn role(s)`)
  } catch (e) { console.log(`  ${profile}: external skipped (${(e as Error).message})`) }
  // Warm paths: alumni from EVERY school in the candidate's profile (graph.json)
  // plus ex-colleagues from their past employers. search.yaml's alumni_network
  // school remains an extra manual anchor (and supplies the display label).
  const an = s.enrichment?.alumni_network
  if (an?.enabled !== false) {
    const graph = readGraph(profile)
    const schools = Array.from(new Set(
      [...(an?.school ? [an.school] : []), ...graph.schools.map((x) => x.name)].map((x) => x.trim()).filter(Boolean),
    )).slice(0, 3)
    // Past employers only — searching "worked at <current co>" mostly returns
    // the candidate's own colleagues, who don't need an intro path.
    const pastCos = graph.employers.filter((e) => !e.current).map((e) => e.name).slice(0, 3)
    const label = an?.label || 'Alumni'
    const kw = (s.keywords || [])[0] || ''
    const companies = keptCompanies(profile).slice(0, 6)
    const byCompany: Record<string, Rec[]> = {}
    for (const co of companies) {
      const recs: Rec[] = []
      for (const school of schools) {
        try {
          recs.push(...(await alumniFor(co, school, label, kw)).map((r) => ({ ...r, path: 'alumni' as PathKind, via: school })))
        } catch (e) { console.log(`  ${profile}/${co}: alumni(${school}) skipped (${(e as Error).message})`) }
      }
      for (const pastCo of pastCos) {
        try {
          recs.push(...(await exColleaguesFor(co, pastCo, kw)))
        } catch (e) { console.log(`  ${profile}/${co}: ex-colleague(${pastCo}) skipped (${(e as Error).message})`) }
      }
      const ranked = rankWarmPaths(dedupeByUrl(recs)).slice(0, 5)
      const checked = await verifyRecs(profile, co, ranked)
      if (checked.length) byCompany[co] = checked
    }
    const enrDir = path.join(dir, '.enrichment')
    fs.mkdirSync(enrDir, { recursive: true })
    fs.writeFileSync(path.join(enrDir, 'alumni.json'), JSON.stringify({
      generated_at: new Date().toISOString().slice(0, 10),
      school: an?.school || schools[0] || '', school_label: label,
      schools, past_companies: pastCos, by_company: byCompany,
    }, null, 2))
    const total = Object.values(byCompany).reduce((n, r) => n + r.length, 0)
    console.log(`  ${profile}: alumni.json — ${total} warm path(s) across ${Object.keys(byCompany).length} companies`)
  }
}

// The same person often shows up via two anchors (alumnus AND ex-colleague);
// keep the first occurrence — rankWarmPaths decides what wins overall.
function dedupeByUrl(recs: Rec[]): Rec[] {
  const seen = new Set<string>()
  return recs.filter((r) => {
    const key = r.url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// Order warm paths so the BEST intro target sits first on the dashboard card.
function rankWarmPaths(recs: Rec[]): Rec[] {
  return recs.sort((a, b) => warmPathScore(b) - warmPathScore(a))
}

function warmPathScore(x: Rec): number {
  // Confirmed ties dominate: any verified contact outranks every unverified
  // one (6 > max unverified score of 3), so a confirmed peer-level alum beats
  // a "maybe Cornell" executive. Shared work history edges out shared school
  // (replies convert better); seniority breaks the remaining ties.
  const confirmed = x.confirmed ? 6 : 0
  const pathBonus = x.path === 'ex-colleague' ? 1 : 0
  const rel = { high: 2, medium: 1, low: 0 }[x.relevance] ?? 0
  return confirmed + pathBonus + rel
}

async function main() {
  if (!EXA_KEY) { console.log('enrich-exa: EXA_API_KEY not set — skipping'); return }
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  console.log(`enrich-exa: ${profiles.length} profile(s)...`)
  for (const p of profiles) await enrichProfile(p)
}
main().catch((e) => { console.error(e); process.exit(1) })
