#!/usr/bin/env npx ts-node
// pi/expand-keywords.ts — profile-driven search-keyword expansion.
//
// search.yaml keywords are what the human typed; this asks Claude Haiku (via the
// exe-dev gateway, same path as triage.ts) for the ADJACENT titles the market
// actually posts — "head of product" also ships as "VP Product", "Chief Product
// Officer", "GM, Product", etc. Expansions multiply coverage on the ATS + Exa
// sources; the Apify LinkedIn source keeps the original keywords (its URL list
// is capped at 10 and the originals are the human's true intent).
//
// Cached at profiles/<name>/.enrichment/keywords.json, regenerated when older
// than 7 days (gateway calls are cheap but not free). No-op without a profile.md.

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { callClaude } from './llm'

const ROOT = path.resolve(__dirname, '..')
const MAX_AGE_DAYS = 7
const MAX_EXPANSIONS = 8

function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example').map((d) => d.name)
}

function callGateway(prompt: string): Promise<string> {
  return callClaude(prompt, { maxTokens: 400, timeoutMs: 30000 })
}

function isFresh(p: string): boolean {
  if (!fs.existsSync(p)) return false
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const age = (Date.now() - new Date(d.generated_at).getTime()) / 86400000
    return age < MAX_AGE_DAYS && Array.isArray(d.expansions)
  } catch { return false }
}

async function expandProfile(profile: string): Promise<void> {
  const dir = path.join(ROOT, 'profiles', profile)
  const out = path.join(dir, '.enrichment', 'keywords.json')
  if (isFresh(out)) { console.log(`  ${profile}: keywords.json fresh — skip`); return }
  const searchPath = path.join(dir, 'search.yaml')
  const profilePath = path.join(dir, 'profile.md')
  if (!fs.existsSync(searchPath) || !fs.existsSync(profilePath)) { console.log(`  ${profile}: missing search.yaml or profile.md — skip`); return }
  const s = yaml.load(fs.readFileSync(searchPath, 'utf-8')) as { keywords?: string[] }
  const keywords = s.keywords || []
  if (!keywords.length) return
  // Headline + summary carry the candidate's actual positioning; experience
  // titles anchor seniority. ~2k chars is plenty of signal for title synonyms.
  const profileHead = fs.readFileSync(profilePath, 'utf-8').slice(0, 2000)

  const prompt = `You expand job-search keywords. A candidate searches for: ${keywords.map((k) => `"${k}"`).join(', ')}.

Their profile (excerpt):
${profileHead}

List up to ${MAX_EXPANSIONS} ADDITIONAL job titles the market uses for the same roles at the same seniority — synonyms and adjacent titles only, no junior variants, no titles the candidate is unqualified for. JSON array of strings only, no preamble.`

  const raw = await callGateway(prompt)
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) throw new Error('no JSON array in gateway reply')
  const have = new Set(keywords.map((k) => k.toLowerCase()))
  const expansions = (JSON.parse(m[0]) as string[])
    .map((t) => String(t).trim())
    .filter((t) => t.length > 2 && t.length < 60 && !have.has(t.toLowerCase()))
    .slice(0, MAX_EXPANSIONS)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString().slice(0, 10), base: keywords, expansions }, null, 2))
  console.log(`  ${profile}: keywords.json — +${expansions.length} expansion(s): ${expansions.join('; ')}`)
}

async function main() {
  const profileArg = (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] || null
  const profiles = profileArg ? [profileArg] : listProfiles()
  for (const p of profiles) {
    try { await expandProfile(p) } catch (e) { console.log(`  ${p}: expansion skipped (${(e as Error).message})`) }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
