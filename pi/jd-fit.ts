#!/usr/bin/env npx ts-node
// pi/jd-fit.ts — JD deep-read + fit scoring for off-LinkedIn roles.
// Runs in the daily cron (ship.sh) after company-dossier, before render.
//
// For each role in profiles/<name>/external.json (fetchable; LinkedIn URLs 999-block
// so they're skipped), pulls the job description via Exa /contents, extracts the
// must-have requirements + top responsibilities, and scores fit against the
// candidate's profile.md with a TRANSPARENT keyword match (matched vs gap items).
//
// Writes profiles/<name>/.enrichment/fit.json: { by_url: { <url>: {...} } }.
// Additive only — never touches queue.md or the other enrichment files. Runs for
// every profile incl. .curated (there's no hand-authored fit data to protect).
// No-op without EXA_API_KEY.

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const EXA_KEY = (process.env.EXA_API_KEY || '').trim()
const STOP = new Set(['the', 'and', 'for', 'with', 'years', 'year', 'experience', 'must', 'have', 'strong', 'similar', 'equivalent', 'knowledge', 'ability', 'including', 'related', 'plus', 'etc', 'such', 'other', 'role', 'work', 'working'])

interface FitEntry {
  url: string; title: string; score: number
  requirements: string; responsibilities: string
  matched: string[]; gaps: string[]
}

function parseArgs() {
  return { profile: (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] || null }
}
function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example').map((d) => d.name)
}
function readExternal(profile: string): Record<string, string>[] {
  const p = path.join(ROOT, 'profiles', profile, 'external.json')
  if (!fs.existsSync(p)) return []
  try { const r = JSON.parse(fs.readFileSync(p, 'utf-8')); return Array.isArray(r) ? r : (r.results || []) } catch { return [] }
}
// Queue entries are scoreable too now that the ATS + Exa sources put fetchable
// (non-LinkedIn) URLs in the queue — score them so the dashboard can rank rows.
function readQueueUrls(profile: string): { url: string }[] {
  const p = path.join(ROOT, 'jobs', 'queue.md')
  if (!fs.existsSync(p)) return []
  let inQueue = false
  const out: { url: string }[] = []
  for (const raw of fs.readFileSync(p, 'utf-8').split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inQueue = true; continue }
    if (s === '## processed') { inQueue = false; continue }
    if (!inQueue) continue
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)/)
    if (m && m[2] === profile) out.push({ url: m[1] })
  }
  return out
}
function profileText(profile: string): string {
  const p = path.join(ROOT, 'profiles', profile, 'profile.md')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').toLowerCase() : ''
}

async function exaContents(url: string): Promise<{ title: string; summary: string }> {
  const res = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'x-api-key': EXA_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      ids: [url], text: false,
      summary: { query: 'REQUIREMENTS: must-have requirements (skills, years, certifications, tools) as a short comma-separated list. RESPONSIBILITIES: top 3 in one line. Label both.' },
    }),
  })
  const d = (await res.json()) as { results?: Record<string, string>[] }
  const r = (d.results || [])[0] || {}
  return { title: (r.title || '').replace(/\s*\|.*$/, '').trim(), summary: (r.summary || '').trim() }
}

function section(summary: string, label: RegExp): string {
  const m = summary.match(label)
  return m ? m[1].trim() : ''
}
// Split the requirements line into discrete items and score each against profile.md.
function scoreFit(reqText: string, profile: string): { score: number; matched: string[]; gaps: string[] } {
  const items = reqText.split(/[;,]|\band\b/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 12)
  const matched: string[] = []; const gaps: string[] = []
  for (const item of items) {
    const words = item.toLowerCase().match(/[a-z0-9.+/]{3,}/g)?.filter((w) => !STOP.has(w)) || []
    const hit = words.some((w) => profile.includes(w))
    if (hit) matched.push(item); else gaps.push(item)
  }
  const total = matched.length + gaps.length
  const score = total ? Math.round((matched.length / total) * 10) : 0
  return { score, matched, gaps }
}

async function fitForRole(url: string, profile: string): Promise<FitEntry | null> {
  try {
    const { title, summary } = await exaContents(url)
    if (!summary) return null
    const requirements = section(summary, /requirements?:?\s*([\s\S]*?)(?:responsibilit|$)/i) || summary
    const responsibilities = section(summary, /responsibilit[^:]*:?\s*([\s\S]*)$/i)
    const { score, matched, gaps } = scoreFit(requirements, profile)
    return { url, title, score, requirements: requirements.slice(0, 600), responsibilities: responsibilities.slice(0, 400), matched, gaps }
  } catch { return null }
}

async function buildProfile(profile: string): Promise<void> {
  const roles = [...readExternal(profile), ...readQueueUrls(profile)]
  if (!roles.length) { console.log(`  ${profile}: no scoreable roles`); return }
  const pText = profileText(profile)
  const byUrl: Record<string, FitEntry> = {}
  for (const r of roles) {
    if (!r.url || /linkedin\.com/i.test(r.url)) continue // LinkedIn 999-blocks JD fetch
    if (byUrl[r.url]) continue // external.json and queue.md overlap
    const fit = await fitForRole(r.url, pText)
    if (fit) byUrl[r.url] = fit
  }
  const enrDir = path.join(ROOT, 'profiles', profile, '.enrichment')
  fs.mkdirSync(enrDir, { recursive: true })
  fs.writeFileSync(path.join(enrDir, 'fit.json'), JSON.stringify({ generated_at: new Date().toISOString().slice(0, 10), by_url: byUrl }, null, 2))
  console.log(`  ${profile}: fit.json — ${Object.keys(byUrl).length} role(s) scored`)
}

async function main() {
  if (!EXA_KEY) { console.log('jd-fit: EXA_API_KEY not set — skipping'); return }
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  console.log(`jd-fit: ${profiles.length} profile(s)...`)
  for (const p of profiles) await buildProfile(p)
}
main().catch((e) => { console.error(e); process.exit(1) })
