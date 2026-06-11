// pi/sources/ats.ts — direct ATS job-board polling (no scraper, no quota).
//
// Greenhouse, Lever, Ashby and SmartRecruiters all expose their public boards
// as unauthenticated JSON. Given a company watchlist, this module resolves each
// company to a board (trying slug guesses across all four ATSes, with a global
// success/failure cache so we only probe each company once a week) and returns
// every posting that matches the profile's keywords + locations.
//
// Resolution cache: jobs/.boards-cache.json — { <company-lower>: { ats, slug } | { miss: true, checked } }
// A miss is retried after 7 days (companies migrate ATS or fix their board).

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..', '..')
const CACHE_PATH = path.join(ROOT, 'jobs', '.boards-cache.json')
const MISS_RETRY_DAYS = 7
const FETCH_TIMEOUT_MS = 10000

export interface AtsJob {
  url: string
  title: string
  company: string
  location: string
  posted: string | null
  source: string // 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'
}

interface BoardHit { ats: string; slug: string }
interface BoardMiss { miss: true; checked: string }
type CacheEntry = BoardHit | BoardMiss
type Cache = Record<string, CacheEntry>

function loadCache(): Cache {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) } catch { return {} }
}
function saveCache(c: Cache): void {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2))
}

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null
    return await res.json()
  } catch { return null } finally { clearTimeout(t) }
}

// Slug guesses, most→least likely: "Turner & Townsend" → turnerandtownsend,
// turner-townsend, turnertownsend. Single-word names yield one guess.
function slugGuesses(company: string): string[] {
  const base = company.toLowerCase().trim()
  const words = base.replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter(Boolean)
  const guesses = new Set<string>([words.join(''), words.join('-')])
  if (words.includes('and')) {
    const without = words.filter((w) => w !== 'and')
    guesses.add(without.join('')); guesses.add(without.join('-'))
  }
  return Array.from(guesses).filter((g) => g.length >= 2)
}

// ── Per-ATS board probes: return jobs if the board exists, null on miss. ─────

async function greenhouse(slug: string): Promise<AtsJob[] | null> {
  const d = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`) as { jobs?: Record<string, unknown>[] } | null
  if (!d || !Array.isArray(d.jobs)) return null
  return d.jobs.map((j) => ({
    url: String(j.absolute_url || ''),
    title: String(j.title || ''),
    company: slug,
    location: String((j.location as Record<string, unknown> | undefined)?.name || ''),
    posted: (j.updated_at as string) || null,
    source: 'greenhouse',
  }))
}

async function lever(slug: string): Promise<AtsJob[] | null> {
  const d = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`)
  if (!Array.isArray(d)) return null
  return (d as Record<string, unknown>[]).map((j) => ({
    url: String(j.hostedUrl || ''),
    title: String(j.text || ''),
    company: slug,
    location: String((j.categories as Record<string, unknown> | undefined)?.location || ''),
    posted: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
    source: 'lever',
  }))
}

async function ashby(slug: string): Promise<AtsJob[] | null> {
  const d = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`) as { jobs?: Record<string, unknown>[] } | null
  if (!d || !Array.isArray(d.jobs)) return null
  return d.jobs.map((j) => ({
    url: String(j.jobUrl || j.applyUrl || ''),
    title: String(j.title || ''),
    company: slug,
    location: String(j.location || ''),
    posted: (j.publishedAt as string) || null,
    source: 'ashby',
  }))
}

async function smartrecruiters(slug: string): Promise<AtsJob[] | null> {
  const d = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`) as { content?: Record<string, unknown>[] } | null
  if (!d || !Array.isArray(d.content) || d.content.length === 0) return null
  return d.content.map((j) => {
    const loc = j.location as Record<string, unknown> | undefined
    return {
      url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`,
      title: String(j.name || ''),
      company: slug,
      location: [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', '),
      posted: (j.releasedDate as string) || null,
      source: 'smartrecruiters',
    }
  })
}

const PROBES: { ats: string; fn: (slug: string) => Promise<AtsJob[] | null> }[] = [
  { ats: 'greenhouse', fn: greenhouse },
  { ats: 'lever', fn: lever },
  { ats: 'ashby', fn: ashby },
  { ats: 'smartrecruiters', fn: smartrecruiters },
]

async function fetchBoard(hit: BoardHit): Promise<AtsJob[]> {
  const probe = PROBES.find((p) => p.ats === hit.ats)
  if (!probe) return []
  return (await probe.fn(hit.slug)) || []
}

// Resolve a company name to its board, probing all ATSes × slug guesses.
// Returns jobs straight from the winning probe so resolution isn't a wasted fetch.
async function resolveAndFetch(company: string, cache: Cache): Promise<{ jobs: AtsJob[]; entry: CacheEntry }> {
  for (const guess of slugGuesses(company)) {
    for (const probe of PROBES) {
      const jobs = await probe.fn(guess)
      if (jobs && jobs.length > 0) return { jobs, entry: { ats: probe.ats, slug: guess } }
    }
  }
  return { jobs: [], entry: { miss: true, checked: new Date().toISOString().slice(0, 10) } }
}

function missExpired(e: BoardMiss): boolean {
  return (Date.now() - new Date(e.checked).getTime()) / 86400000 >= MISS_RETRY_DAYS
}

function matchesSearch(job: AtsJob, keywords: string[], locations: string[]): boolean {
  const title = job.title.toLowerCase()
  // Every significant word of at least one keyword must appear in the title —
  // "head of product" matches "Head of Product, Growth" but not "Product Designer".
  const kwHit = keywords.some((k) => {
    const words = k.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && w !== 'of' && w !== 'the')
    return words.length > 0 && words.every((w) => title.includes(w))
  })
  if (!kwHit) return false
  if (!locations.length) return true
  const loc = job.location.toLowerCase()
  return locations.some((l) => {
    const ll = l.toLowerCase()
    if (/remote/.test(ll)) return /remote|anywhere/.test(loc) || loc === ''
    return loc.includes(ll.split(',')[0].trim()) || /remote|anywhere/.test(loc)
  })
}

// Main entry: poll boards for `companies`, return postings matching the search.
// `companies` should already be capped by the caller (each unresolved company
// costs up to ~12 probe requests; resolved ones cost 1).
export async function atsDiscover(
  companies: string[],
  keywords: string[],
  locations: string[],
): Promise<{ jobs: AtsJob[]; resolved: number; missed: number }> {
  const cache = loadCache()
  const all: AtsJob[] = []
  let resolved = 0
  let missed = 0
  for (const company of companies) {
    const key = company.toLowerCase().trim()
    let entry = cache[key]
    let jobs: AtsJob[] = []
    if (entry && !('miss' in entry)) {
      jobs = await fetchBoard(entry)
    } else if (!entry || missExpired(entry as BoardMiss)) {
      const r = await resolveAndFetch(company, cache)
      entry = r.entry
      cache[key] = entry
      jobs = r.jobs
    }
    if (entry && !('miss' in entry)) {
      resolved++
      // Board postings carry the slug as company; restore the human-readable name.
      jobs.forEach((j) => { j.company = company })
      all.push(...jobs.filter((j) => j.url && matchesSearch(j, keywords, locations)))
    } else {
      missed++
    }
  }
  saveCache(cache)
  return { jobs: all, resolved, missed }
}
