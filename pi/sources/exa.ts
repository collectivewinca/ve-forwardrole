// pi/sources/exa.ts — Exa neural search as a first-class discovery source.
//
// enrich-exa.ts already finds non-LinkedIn roles but only writes them to
// external.json for the dashboard's "Other sources" tab — they never entered
// the triage funnel. This source runs at discover time with the EXPANDED
// keyword set and feeds queue.md like any other source, so off-LinkedIn roles
// get triaged, fit-scored, and tailored like everything else.
//
// No-op (returns []) without EXA_API_KEY.

const ATS_DOMAINS = [
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co',
  'myworkdayjobs.com', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com', 'icims.com',
]

export interface ExaJob {
  url: string
  title: string
  company: string
  location: string
  posted: string | null
  source: 'exa'
}

function field(summary: string, label: RegExp): string | undefined {
  const m = summary.match(label)
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 120) : undefined
}

export async function exaDiscover(
  keywords: string[],
  locations: string[],
  maxResults: number,
): Promise<ExaJob[]> {
  const key = (process.env.EXA_API_KEY || '').trim()
  if (!key) return []
  const out: ExaJob[] = []
  const seen = new Set<string>()
  // One query per keyword beats one mega-OR query: Exa's neural search dilutes
  // with too many disjuncts, and per-keyword queries parallelize the quota.
  for (const kw of keywords.slice(0, 6)) {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `"${kw}" job opening ${locations.join(' ')}`,
        numResults: 10,
        type: 'auto',
        includeDomains: ATS_DOMAINS,
        startPublishedDate: new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10),
        contents: { summary: { query: 'Exact job title; hiring company; location (city or remote). One short line, label each.' } },
      }),
    }).then((r) => r.json() as Promise<{ results?: Record<string, string>[] }>).catch(() => ({ results: [] }))
    for (const r of res.results || []) {
      if (!r.url || seen.has(r.url)) continue
      seen.add(r.url)
      const summary = (r.summary || '').replace(/\s+/g, ' ').trim()
      const title = field(summary, /(?:job\s+)?title[:\s]+(.+?)(?:\s*;|\s+hiring|$)/i) || (r.title || '').replace(/\s*\|.*$/, '').trim()
      const company = field(summary, /(?:hiring\s+)?company[:\s]+([^;.\n)]+)/i) || ''
      if (!title || title.length < 4) continue
      out.push({
        url: r.url,
        title,
        company: company || new URL(r.url).hostname.replace(/^www\./, ''),
        location: field(summary, /location[:\s]+([^;.\n)]+)/i) || '',
        posted: r.publishedDate || null,
        source: 'exa',
      })
      if (out.length >= maxResults) return out
    }
  }
  return out
}
