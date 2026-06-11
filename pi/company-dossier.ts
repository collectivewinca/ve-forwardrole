#!/usr/bin/env npx ts-node
// pi/company-dossier.ts — Per-profile, per-company sourced dossiers for the
// dashboard "Companies" tab. Runs in the daily cron (ship.sh) after enrich-exa.
//
// Writes profiles/<name>/.enrichment/companies.json:
//   { generated_at, by_company: { <co>: { overview, employer_type, news[], deals[],
//     talking_point, sources[] } } }
//
// Each company gets 3 Exa passes (overview + recent news + deals/contracts);
// every news/deal item keeps its source URL so the candidate can verify before
// applying. No-op without EXA_API_KEY. Skips profiles with a `.curated` marker.

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const ROOT = path.resolve(__dirname, '..')
const QUEUE = path.join(ROOT, 'jobs', 'queue.md')
const EXA_KEY = (process.env.EXA_API_KEY || '').trim()
const RECRUITER = /cybercoders|w3global|metric geo|kos international|jobgether|robert half|staffing|recruit|talent group|talent solutions/i
const MAX_COMPANIES = 6

interface NewsItem { date: string; title: string; url: string }
interface DealItem { date: string; summary: string; url: string }

function parseArgs() {
  return { profile: (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] || null }
}
function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example').map((d) => d.name)
}
function keptCompanies(profile: string): string[] {
  if (!fs.existsSync(QUEUE)) return []
  const text = fs.readFileSync(QUEUE, 'utf-8')
  let inQueue = false
  const seen = new Set<string>(); const out: string[] = []
  for (const raw of text.split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inQueue = true; continue }
    if (s === '## processed') { inQueue = false; continue }
    if (!inQueue) continue
    const m = raw.match(/\|\s*profile=(\S+)\s+<!--\s*.+?\s+@\s+(.+?)\s*-->/)
    if (!m || m[1] !== profile) continue
    const co = m[2].trim()
    if (RECRUITER.test(co)) continue
    const key = co.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(co) }
  }
  return out
}

async function exa(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as Record<string, unknown>
}
function results(r: Record<string, unknown>): Record<string, string>[] {
  return (r.results as Record<string, string>[]) || []
}
function employerType(overview: string): string {
  // Recruiters are already filtered out of keptCompanies, so default to direct
  // employer and only flag on an explicit positive noun phrase (not a negation).
  const o = overview.toLowerCase()
  const positive = /(staffing|recruiting|recruitment)\s+(agency|firm|company)/.test(o)
  const negated = /not a (staffing|recruiting|recruitment)/.test(o)
  return positive && !negated ? 'Staffing / recruiting agency' : 'Direct employer'
}
function monthsAgoISO(n: number): string {
  const d = new Date(); d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

async function dossier(company: string) {
  const ov = await exa({
    query: `${company} company`, numResults: 3, type: 'auto',
    contents: { summary: { query: `In 2 sentences: what does ${company} do, HQ, approx size, and is it a direct employer or a staffing/recruiting agency?` } },
  })
  const overview = (results(ov)[0]?.summary || '').trim()
  const news = await exa({
    query: `${company} news`, category: 'news', numResults: 4, type: 'auto',
    startPublishedDate: monthsAgoISO(8),
    contents: { summary: { query: 'One-line summary of this news item.' } },
  })
  const deals = await exa({
    query: `${company} acquisition OR funding OR contract award OR new project`, numResults: 3, type: 'auto',
    contents: { summary: { query: 'One line: what deal/contract/award and roughly when.' } },
  })
  const newsItems: NewsItem[] = results(news).filter((x) => x.url).slice(0, 4)
    .map((x) => ({ date: (x.publishedDate || '').slice(0, 10), title: (x.title || '').trim(), url: x.url }))
  const dealItems: DealItem[] = results(deals).filter((x) => x.url).slice(0, 3)
    .map((x) => ({ date: (x.publishedDate || '').slice(0, 10), summary: (x.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160), url: x.url }))
  // Auto talking point from the freshest signal.
  const top = dealItems[0]?.summary || newsItems[0]?.title || ''
  return {
    overview, employer_type: employerType(overview),
    news: newsItems, deals: dealItems,
    talking_point: top ? `Reference their recent move — "${top}" — to show you follow the company.` : '',
    sources: results(ov).filter((x) => x.url).slice(0, 2).map((x) => x.url),
  }
}

async function buildProfile(profile: string): Promise<void> {
  const dir = path.join(ROOT, 'profiles', profile)
  if (fs.existsSync(path.join(dir, '.curated'))) { console.log(`  ${profile}: .curated — skipping`); return }
  if (!fs.existsSync(path.join(dir, 'search.yaml'))) { console.log(`  ${profile}: no search.yaml — skip`); return }
  const companies = keptCompanies(profile).slice(0, MAX_COMPANIES)
  if (!companies.length) { console.log(`  ${profile}: no companies`); return }
  const byCompany: Record<string, unknown> = {}
  for (const co of companies) {
    try { byCompany[co] = await dossier(co) }
    catch (e) { console.log(`  ${profile}/${co}: dossier skipped (${(e as Error).message})`) }
  }
  const enrDir = path.join(dir, '.enrichment')
  fs.mkdirSync(enrDir, { recursive: true })
  fs.writeFileSync(path.join(enrDir, 'companies.json'), JSON.stringify({
    generated_at: new Date().toISOString().slice(0, 10), by_company: byCompany,
  }, null, 2))
  console.log(`  ${profile}: companies.json — ${Object.keys(byCompany).length} dossier(s)`)
}

async function main() {
  if (!EXA_KEY) { console.log('company-dossier: EXA_API_KEY not set — skipping'); return }
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  console.log(`company-dossier: ${profiles.length} profile(s)...`)
  for (const p of profiles) await buildProfile(p)
}
main().catch((e) => { console.error(e); process.exit(1) })
