// pi/sources/feeds.ts — remote-job-board feeds as a discovery source.
//
// Free, keyless JSON APIs that index remote roles across the web — exactly
// where fractional/contract and remote-first roles live that don't appear on
// a single company's ATS board. Gated by the caller: only runs for profiles
// that want remote work, so on-site seekers never see these.
//
//   Remotive   https://remotive.com/api/remote-jobs?search=  (has job_type)
//   RemoteOK   https://remoteok.com/api?tags=                 (volume)

export interface FeedJob {
  url: string
  title: string
  company: string
  location: string
  posted: string | null
  source: 'remotive' | 'remoteok'
}

// Map our job_types to Remotive's job_type values.
const REMOTIVE_TYPE: Record<string, string> = {
  'full-time': 'full_time', 'part-time': 'part_time', contract: 'contract',
  contractual: 'contract', temporary: 'contract', freelance: 'freelance',
}

const FETCH_TIMEOUT_MS = 15000

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 've-forwardrole' } })
    if (!res.ok) return null
    return await res.json()
  } catch { return null } finally { clearTimeout(t) }
}

// Title match for the high-volume open boards (mostly software roles). A bare
// generic word like "product" matches "Staff Software Engineer, Product", so
// we require the keyword to be SPECIFIC: at least two significant words present,
// OR a single distinctive word (not a generic role token). This is stricter
// than the ATS source because the feed corpus is noisier.
const GENERIC_KW = new Set(['product', 'ai', 'head', 'senior', 'lead', 'manager', 'director', 'remote', 'staff', 'principal'])
function titleMatches(title: string, keywords: string[]): boolean {
  const t = title.toLowerCase()
  return keywords.some((k) => {
    const words = k.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && w !== 'of' && w !== 'the')
    if (words.length === 0) return false
    if (!words.every((w) => t.includes(w))) return false
    // A single generic word is not enough signal on a noisy board.
    return words.length >= 2 || !GENERIC_KW.has(words[0])
  })
}

async function remotive(keywords: string[], jobTypes: string[]): Promise<FeedJob[]> {
  const wantTypes = new Set(jobTypes.map((j) => REMOTIVE_TYPE[j.toLowerCase().trim()]).filter(Boolean))
  const out: FeedJob[] = []
  const seen = new Set<string>()
  for (const kw of keywords.slice(0, 5)) {
    const d = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(kw)}&limit=40`) as { jobs?: Record<string, unknown>[] } | null
    for (const j of d?.jobs || []) {
      const url = String(j.url || '')
      if (!url || seen.has(url)) continue
      const title = String(j.title || '')
      if (!titleMatches(title, keywords)) continue
      // If the profile specified job types, honor Remotive's structured field.
      if (wantTypes.size && j.job_type && !wantTypes.has(String(j.job_type))) continue
      seen.add(url)
      out.push({
        url, title,
        company: String(j.company_name || ''),
        location: String(j.candidate_required_location || 'Remote'),
        posted: (j.publication_date as string) || null,
        source: 'remotive',
      })
    }
  }
  return out
}

async function remoteOk(keywords: string[]): Promise<FeedJob[]> {
  // RemoteOK has no job_type field; it's a volume source. Tag search on the
  // first significant keyword word, then title-filter the same way.
  const tag = (keywords[0] || 'product').toLowerCase().split(/\s+/).filter((w) => w.length > 2)[0] || 'product'
  const d = await getJson(`https://remoteok.com/api?tags=${encodeURIComponent(tag)}`)
  if (!Array.isArray(d)) return []
  const out: FeedJob[] = []
  for (const j of d as Record<string, unknown>[]) {
    const url = String(j.url || j.apply_url || '')
    const title = String(j.position || '')
    if (!url || !title || !titleMatches(title, keywords)) continue
    out.push({
      url, title,
      company: String(j.company || ''),
      location: String(j.location || 'Remote'),
      posted: (j.date as string) || null,
      source: 'remoteok',
    })
  }
  return out
}

// Gated entry point — the caller decides whether the profile wants remote.
export async function feedsDiscover(
  keywords: string[],
  jobTypes: string[],
  maxResults: number,
): Promise<FeedJob[]> {
  const results = await Promise.all([
    remotive(keywords, jobTypes).catch(() => [] as FeedJob[]),
    remoteOk(keywords).catch(() => [] as FeedJob[]),
  ])
  const out: FeedJob[] = []
  const seen = new Set<string>()
  for (const j of results.flat()) {
    const key = j.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(j)
    if (out.length >= maxResults) break
  }
  return out
}
