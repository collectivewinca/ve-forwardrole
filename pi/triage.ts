#!/usr/bin/env npx ts-node
// pi/triage.ts — Auto-triage discovered URLs via the exe-dev LLM gateway.
//
// For each entry in ## Queue, asks Claude Haiku to classify keep/skip
// against the candidate's filters in profiles/<name>/search.yaml.
// "skip" entries move to ## Processed with a one-line reason; "keep"
// stay in the queue for the human to tailor.
//
// Designed to run AFTER pi/discover.ts in the same cron. Leaves queue.md
// dirty; pi/ship.sh commits the combined diff.

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { callClaude } from './llm'

const ROOT = path.resolve(__dirname, '..')
const QUEUE_PATH = path.join(ROOT, 'jobs', 'queue.md')

interface SearchConfig {
  keywords: string[]
  locations: string[]
  exclude_keywords?: string[]
  triage?: {
    hard_no_keywords?: string[]
    notes?: string
  }
}

interface QueueEntry {
  index: number
  raw: string
  url: string
  profile: string
  title: string
}

interface TriageResult {
  verdict: 'keep' | 'skip'
  reason: string
}

function parseArgs() {
  return {
    dryRun: process.argv.includes('--dry-run'),
    profile: (process.argv.find((a: string) => a.startsWith('--profile=')) || '').split('=')[1] || null,
  }
}

function readSearchConfig(profile: string): SearchConfig | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  return yaml.load(fs.readFileSync(p, 'utf-8')) as SearchConfig
}

// Onboarding preferences (.enrichment/prefs.json) — written by the dashboard
// wizard. comp.floor is the SEARCH floor (stated minimum + uplift); it is
// deliberately not shown in any UI, it only shapes triage here.
interface Prefs {
  availability?: string
  comp?: { floor?: number; currency?: string }
  hard_nos?: string[]
  stage?: string
  sponsorship_needed?: boolean
}
function readPrefs(profile: string): Prefs {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'prefs.json')
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as Prefs } catch { return {} }
}

function readQueue(): { lines: string[]; entries: QueueEntry[] } {
  const text = fs.readFileSync(QUEUE_PATH, 'utf-8')
  const lines = text.split('\n')
  let inProcessed = false
  const entries: QueueEntry[] = []
  lines.forEach((raw: string, index: number) => {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === '## queue') { inProcessed = false; return }
    if (trimmed === '## processed') { inProcessed = true; return }
    if (inProcessed) return
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)(?:\s+<!--\s*(.+?)\s*-->)?/)
    if (!m) return
    entries.push({ index, raw, url: m[1], profile: m[2], title: m[3] || '' })
  })
  return { lines, entries }
}

function callGateway(prompt: string): Promise<string> {
  return callClaude(prompt, { maxTokens: 150, timeoutMs: 30000 })
}

function buildPrompt(entry: QueueEntry, config: SearchConfig, prefs: Prefs): string {
  const hardNos = [
    ...(config.exclude_keywords || []),
    ...(config.triage?.hard_no_keywords || []),
    ...(prefs.hard_nos || []),
  ]
  const wantsRemote = config.locations.some((l: string) => /remote/i.test(l))
  const compRule = prefs.comp?.floor
    ? `\n- Disclosed compensation clearly below ${prefs.comp.currency || 'USD'} ${Math.round(prefs.comp.floor / 1000)}K: if the title/comment shows a pay range whose TOP is under that number, SKIP. If pay is not disclosed, do NOT skip for comp.`
    : ''
  const visaRule = prefs.sponsorship_needed
    ? `\n- Candidate needs visa sponsorship: titles or notes saying "no sponsorship", "US citizens only", "must have work authorization without sponsorship" → SKIP.`
    : ''
  const contextNotes = [
    config.triage?.notes,
    prefs.stage && prefs.stage !== 'any' ? `prefers ${prefs.stage} companies` : '',
    prefs.availability ? `availability: ${prefs.availability}` : '',
  ].filter(Boolean).join('; ')
  return `You triage job listings for a candidate. Output JSON only: {"verdict":"keep"|"skip","reason":"short phrase"}.

Default to KEEP — only SKIP if a hard filter clearly fails. The human reviews everything kept.

Candidate filters:
- Wants role keywords: ${config.keywords.join(', ')}
- Wants locations: ${config.locations.join(', ')}${wantsRemote ? ' (open to remote)' : ''}
- Hard NOs: ${hardNos.join(', ') || 'none'}
- Notes: ${contextNotes || '(none)'}

Listing:
- Title: ${entry.title}
- URL: ${entry.url}

Hard SKIP rules:
- Title contains any Hard NO term (case-insensitive substring)
- Title clearly indicates wrong seniority for the candidate's stated keywords (e.g. "Junior" when filters say "Director" or "Executive")
- URL host indicates a country obviously outside the candidate's wanted locations AND remote is NOT in their list. LinkedIn regional hosts: my.=Malaysia, li.=Liechtenstein, ca.=Canada, uk.=UK, in.=India, de.=Germany, fr.=France, etc.${compRule}${visaRule}

Anything else: KEEP. When uncertain, KEEP.

JSON only, no preamble.`
}

function parseTriage(text: string): TriageResult {
  const m = text.match(/\{[\s\S]*?\}/)
  if (!m) return { verdict: 'keep', reason: 'parse-failed' }
  try {
    const d = JSON.parse(m[0])
    if (d.verdict === 'skip' || d.verdict === 'keep') {
      return { verdict: d.verdict, reason: String(d.reason || '').slice(0, 80) }
    }
  } catch {
    // fall through
  }
  return { verdict: 'keep', reason: 'parse-failed' }
}

function rewriteQueue(lines: string[], skips: Map<number, string>): void {
  const movedLines: string[] = []
  const kept: string[] = []
  lines.forEach((line: string, i: number) => {
    if (skips.has(i)) {
      movedLines.push(`${line}  <!-- skipped: ${skips.get(i)} -->`)
    } else {
      kept.push(line)
    }
  })
  const processedIdx = kept.findIndex((l: string) => l.trim().toLowerCase() === '## processed')
  if (processedIdx === -1) throw new Error('Missing ## Processed header')
  kept.splice(processedIdx + 1, 0, ...movedLines)
  fs.writeFileSync(QUEUE_PATH, kept.join('\n'))
}

async function main() {
  const opts = parseArgs()
  const { lines, entries } = readQueue()
  const filtered = opts.profile ? entries.filter((e: QueueEntry) => e.profile === opts.profile) : entries
  if (filtered.length === 0) {
    console.log('No queued entries to triage.')
    return
  }
  console.log(`Triaging ${filtered.length} entries via exe-dev gateway → claude-haiku-4-5...\n`)

  const configCache: Record<string, SearchConfig | null> = {}
  const skips = new Map<number, string>()
  const stats: Record<string, { kept: number; skipped: number; errored: number }> = {}

  for (const e of filtered) {
    if (!(e.profile in configCache)) configCache[e.profile] = readSearchConfig(e.profile)
    const config = configCache[e.profile]
    stats[e.profile] = stats[e.profile] || { kept: 0, skipped: 0, errored: 0 }
    if (!config) { stats[e.profile].errored++; continue }

    try {
      const llmOut = opts.dryRun
        ? '{"verdict":"keep","reason":"dry-run"}'
        : await callGateway(buildPrompt(e, config, readPrefs(e.profile)))
      const result = parseTriage(llmOut)
      const tag = result.verdict === 'skip' ? '✗' : '✓'
      console.log(`  [${e.profile}] ${tag} ${e.title.slice(0, 60)} — ${result.reason}`)
      if (result.verdict === 'skip') {
        skips.set(e.index, result.reason)
        stats[e.profile].skipped++
      } else {
        stats[e.profile].kept++
      }
    } catch (err) {
      console.error(`  [${e.profile}] ! ${e.url.slice(0, 60)} — ${(err as Error).message}`)
      stats[e.profile].errored++
    }
  }

  console.log('\nSummary:')
  for (const [p, s] of Object.entries(stats)) {
    console.log(`  ${p}: ${s.kept} kept, ${s.skipped} skipped${s.errored ? `, ${s.errored} errored` : ''}`)
  }

  if (!opts.dryRun && skips.size > 0) {
    rewriteQueue(lines, skips)
    console.log(`\nMoved ${skips.size} entries to ## Processed.`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
