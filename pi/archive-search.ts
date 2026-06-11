#!/usr/bin/env npx ts-node
// pi/archive-search.ts — per-profile search history.
// Runs BEFORE discover (npm prediscover hook) so it sees the OLD shortlist while it
// still reflects the OLD search parameters. When a profile's search.yaml keywords or
// locations change, it snapshots the current shortlist (the results of the old params)
// into .enrichment/history.json before the new discovery overwrites them.
//
// Files per profile:
//   .enrichment/search-meta.json  { fingerprint, keywords[], locations[], updated_at }
//   .enrichment/history.json      { versions: [ { archived_at, keywords[], locations[], roles[] } ] }
//
// No-op when params are unchanged (the daily case). Idempotent.

import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'

const ROOT = path.resolve(__dirname, '..')
const QUEUE = path.join(ROOT, 'jobs', 'queue.md')
const MAX_VERSIONS = 12

interface Role { url: string; title: string; company: string }
interface SearchCfg { keywords?: string[]; locations?: string[] }

function parseArgs() {
  return { profile: (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1] || null }
}
function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example').map((d) => d.name)
}
function readSearch(profile: string): SearchCfg | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  try { return yaml.load(fs.readFileSync(p, 'utf-8')) as SearchCfg } catch { return null }
}
function fingerprint(s: SearchCfg): string {
  const k = [...(s.keywords || [])].map((x) => x.toLowerCase().trim()).sort()
  const l = [...(s.locations || [])].map((x) => x.toLowerCase().trim()).sort()
  return JSON.stringify({ k, l })
}
function activeShortlist(profile: string): Role[] {
  if (!fs.existsSync(QUEUE)) return []
  const text = fs.readFileSync(QUEUE, 'utf-8')
  let inQueue = false
  const out: Role[] = []
  for (const raw of text.split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inQueue = true; continue }
    if (s === '## processed') { inQueue = false; continue }
    if (!inQueue) continue
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)\s+<!--\s*(.+?)\s+@\s+(.+?)\s*-->/)
    if (!m || m[2] !== profile) continue
    out.push({ url: m[1], title: m[3], company: m[4] })
  }
  return out
}
function readJSON<T>(p: string, fallback: T): T {
  if (!fs.existsSync(p)) return fallback
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return fallback }
}

function archiveProfile(profile: string, stamp: string): void {
  const cfg = readSearch(profile)
  if (!cfg) return
  const dir = path.join(ROOT, 'profiles', profile, '.enrichment')
  fs.mkdirSync(dir, { recursive: true })
  const metaPath = path.join(dir, 'search-meta.json')
  const histPath = path.join(dir, 'history.json')
  const fp = fingerprint(cfg)
  const meta = readJSON<{ fingerprint?: string; keywords?: string[]; locations?: string[] }>(metaPath, {})

  if (meta.fingerprint === fp) return // unchanged — nothing to do

  // Params changed (and we have a prior meta) -> archive the current shortlist,
  // labelled with the OLD params it was produced under.
  if (meta.fingerprint) {
    const roles = activeShortlist(profile)
    if (roles.length) {
      const hist = readJSON<{ versions: unknown[] }>(histPath, { versions: [] })
      hist.versions.unshift({
        archived_at: stamp,
        keywords: meta.keywords || [],
        locations: meta.locations || [],
        roles,
      })
      hist.versions = hist.versions.slice(0, MAX_VERSIONS)
      fs.writeFileSync(histPath, JSON.stringify(hist, null, 2))
      console.log(`  ${profile}: archived ${roles.length} role(s) from the previous search`)
    }
  }
  fs.writeFileSync(metaPath, JSON.stringify({
    fingerprint: fp, keywords: cfg.keywords || [], locations: cfg.locations || [], updated_at: stamp,
  }, null, 2))
}

function main() {
  const opts = parseArgs()
  const stamp = new Date().toISOString().slice(0, 10)
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  for (const p of profiles) archiveProfile(p, stamp)
}
main()
