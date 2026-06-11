#!/usr/bin/env npx ts-node
// pi/render.ts — Per-profile shortlist HTML renderer + here.now publisher.
//
// Reads queue.md + per-profile applications.md + enrichment state, writes
// a styled HTML shortlist to /tmp/render-<profile>/index.html, then
// invokes the here.now publish script under publish.slug from search.yaml.

import * as fs from 'fs'
import * as path from 'path'
import * as child_process from 'child_process'
import * as yaml from 'js-yaml'

const ROOT = path.resolve(__dirname, '..')
const QUEUE_PATH = path.join(ROOT, 'jobs', 'queue.md')
const HERENOW_SCRIPT = process.env.HERENOW_PUBLISH_SCRIPT || '/Users/aletviegas/.claude/skills/here-now/scripts/publish.sh'

interface SearchConfig {
  enrichment?: { alumni_network?: { label?: string; school?: string } }
  publish?: { slug?: string; password?: string }
}
interface QueueEntry { url: string; profile: string; title: string; company: string }
interface AlumniHit { name: string; snippet: string; url: string; verified?: boolean; verify_reason?: string }
interface EnrichmentState {
  generated_at?: string
  school?: string
  school_label?: string
  listings?: Record<string, 'ACTIVE' | 'EXPIRED' | 'UNKNOWN'>
  alumni?: Record<string, AlumniHit[]>
}

function parseArgs() {
  return {
    profile: (process.argv.find((a: string) => a.startsWith('--profile=')) || '').split('=')[1] || null,
    publish: !process.argv.includes('--no-publish'),
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function listProfiles(): string[] {
  return fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'example')
    .map((d) => d.name)
}

function readConfig(profile: string): SearchConfig | null {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return null
  return yaml.load(fs.readFileSync(p, 'utf-8')) as SearchConfig
}

function readEnrichment(profile: string): EnrichmentState {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'state.json')
  if (!fs.existsSync(p)) return {}
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

// Roles sourced outside LinkedIn (company careers / other boards) — profiles/<name>/external.json
interface ExternalResult { url: string; title: string; company: string; source: string; location?: string; note?: string }
function readExternal(profile: string): ExternalResult[] {
  const p = path.join(ROOT, 'profiles', profile, 'external.json')
  if (!fs.existsSync(p)) return []
  try { const raw = JSON.parse(fs.readFileSync(p, 'utf-8')); return Array.isArray(raw) ? raw : (raw.results || []) } catch { return [] }
}

// Vetted alumni recommendations — profiles/<name>/.enrichment/alumni.json.
// Pre-judged upstream (fact-extraction + relevance scoring): each person has a
// real title, Cornell detail, confirmed flag, relevance, reason and intro angle.
// Same schema the dashboard reads. We only rank here.
type Relevance = 'high' | 'medium' | 'low'
interface AlumniRec {
  name: string; url: string; title?: string; cornell?: string
  confirmed: boolean; relevance: Relevance; reason?: string; intro_angle?: string
  path?: 'alumni' | 'ex-colleague'; via?: string
}

// JD fit scores (pi/jd-fit.ts) — keyed by url, covers every fetchable role.
function readFit(profile: string): Record<string, { score: number }> {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'fit.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')).by_url || {} } catch { return {} }
}
function rankScore(p: AlumniRec): number {
  const rel = { high: 2, medium: 1, low: 0 }[p.relevance] ?? 0
  return (p.confirmed ? 3 : 0) + rel
}
function readAlumni(profile: string): Record<string, AlumniRec[]> {
  const p = path.join(ROOT, 'profiles', profile, '.enrichment', 'alumni.json')
  if (!fs.existsSync(p)) return {}
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const out: Record<string, AlumniRec[]> = {}
    for (const [co, ppl] of Object.entries<AlumniRec[]>(raw.by_company || {})) {
      out[co] = [...ppl].sort((a, b) => rankScore(b) - rankScore(a))
    }
    return out
  } catch { return {} }
}

// Every network the candidate belongs to (schools + past employers), for the
// per-company "Find <network> on LinkedIn" deep-link rows. From alumni.json,
// with the configured school as a guaranteed member.
interface Network { label: string; query: string }
function readNetworks(profile: string, school: string, schoolLabel: string): Network[] {
  const out: Network[] = []
  const seen = new Set<string>()
  const add = (label: string, query: string) => {
    if (!query || seen.has(query.toLowerCase())) return
    seen.add(query.toLowerCase())
    out.push({ label, query })
  }
  if (school) add(schoolLabel || `${school.split(',')[0]} alumni`, school)
  const pth = path.join(ROOT, 'profiles', profile, '.enrichment', 'alumni.json')
  try {
    const raw = JSON.parse(fs.readFileSync(pth, 'utf-8'))
    for (const s of raw.schools || []) add(`${String(s).split(',')[0].replace(/\s+(University|College|Institute)( of.*)?$/i, '')} alumni`, String(s))
    for (const c of raw.past_companies || []) add(`Ex-${c}`, `"${c}"`)
  } catch { /* enrichment not run yet */ }
  return out.slice(0, 4)
}

function readQueueEntries(profile: string): QueueEntry[] {
  const text = fs.readFileSync(QUEUE_PATH, 'utf-8')
  let inProcessed = false
  const out: QueueEntry[] = []
  for (const raw of text.split('\n')) {
    const s = raw.trim().toLowerCase()
    if (s === '## queue') { inProcessed = false; continue }
    if (s === '## processed') { inProcessed = true; continue }
    if (inProcessed) continue
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)\s+<!--\s*(.+?)\s+@\s+(.+?)\s*-->/)
    if (!m || m[2] !== profile) continue
    out.push({ url: m[1], profile: m[2], title: m[3], company: m[4] })
  }
  return out
}

function readApplications(profile: string): { company: string; score: number }[] {
  const p = path.join(ROOT, 'profiles', profile, 'applications.md')
  if (!fs.existsSync(p)) return []
  const text = fs.readFileSync(p, 'utf-8')
  const apps: { company: string; score: number }[] = []
  const entryRe = /^##\s+(.+?)\s+—\s+(.+?)$/gm
  for (const m of text.matchAll(entryRe)) {
    const company = m[1].trim()
    const scoreM = text.slice(m.index || 0).match(/\*\*Match Score:\*\*\s+(\d+)/)
    apps.push({ company, score: scoreM ? parseInt(scoreM[1], 10) : 0 })
  }
  return apps
}

function linkedinAlumniSearchUrl(company: string, school: string): string {
  // LinkedIn's people-search URL with current-company keyword + school keyword.
  // Lands the user in their own authenticated LinkedIn session, where filters
  // pre-applied via the URL show real verified alumni at the company.
  const q = encodeURIComponent(`${company} ${school}`)
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`
}

function renderRow(idx: number, e: QueueEntry, _hits: AlumniHit[], alumLabel: string, tailoredScore: number | null, school: string, fitScore: number | null, warmCount: number): string {
  const linkedinUrl = linkedinAlumniSearchUrl(e.company, school)
  const alumBlock = `<div class="cornell-row"><a class="cornell-deep-link" href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener">Find ${escapeHtml(alumLabel)} at ${escapeHtml(e.company)} on LinkedIn →</a></div>`
  const badges: string[] = []
  if (tailoredScore !== null) badges.push(`<span class="badge tailored-badge">Match ${tailoredScore}/10 · tailored</span>`)
  if (fitScore !== null) badges.push(`<span class="badge fit-badge">Fit ${fitScore}/10</span>`)
  if (warmCount > 0) badges.push(`<span class="badge warm-badge">${warmCount} warm path${warmCount === 1 ? '' : 's'}</span>`)
  const tailoredBadge = badges.length ? `<div class="badge-row">${badges.join(' ')}</div>` : ''
  const cls = tailoredScore !== null ? ' tailored' : ''
  return `
    <article class="row${cls}">
      <div class="num">${String(idx).padStart(2, '0')}</div>
      <div class="body">
        <h2 class="title">${escapeHtml(e.title)}</h2>
        <p class="company">@ ${escapeHtml(e.company)}</p>
        ${tailoredBadge}
        ${alumBlock}
      </div>
      <a class="apply" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Apply →</a>
    </article>`
}

function renderClosedCard(e: QueueEntry, _hits: AlumniHit[], alumLabel: string, school: string): string {
  const linkedinUrl = linkedinAlumniSearchUrl(e.company, school)
  const alumBlock = `<div class="cornell-row"><a class="cornell-deep-link" href="${escapeHtml(linkedinUrl)}" target="_blank" rel="noopener">Find ${escapeHtml(alumLabel)} at ${escapeHtml(e.company)} on LinkedIn →</a></div>`
  return `
    <div class="closed-card">
      <h3 class="closed-title">${escapeHtml(e.title)}</h3>
      <p class="closed-meta">@ ${escapeHtml(e.company)} · <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">view closed posting</a></p>
      ${alumBlock}
    </div>`
}

function renderExternalSection(external: ExternalResult[]): string {
  if (!external.length) return ''
  const cards = external.map((e) => `
    <div class="closed-card">
      <h3 class="closed-title">${escapeHtml(e.title)}</h3>
      <p class="closed-meta"><span class="src-badge">${escapeHtml(e.source)}</span> @ ${escapeHtml(e.company)}${e.location ? ' · ' + escapeHtml(e.location) : ''} · <a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">view role →</a></p>
      ${e.note ? `<p class="ext-note">${escapeHtml(e.note)}</p>` : ''}
    </div>`).join('\n')
  return `<section class="signal-block">
    <p class="kicker">beyond linkedin</p>
    <h2>${external.length} role${external.length === 1 ? '' : 's'} found on company sites &amp; other boards</h2>
    <p class="lede">Sourced beyond LinkedIn — company career pages and other job boards, screened for fit and location.</p>
${cards}
  </section>`
}

function renderAlumniSection(alumni: Record<string, AlumniRec[]>, alumLabel: string, networks: Network[]): string {
  const companies = Object.keys(alumni)
  if (!companies.length) return ''
  const netLinks = (co: string) => networks.map((n) =>
    `<a class="cornell-deep-link" href="${escapeHtml(linkedinAlumniSearchUrl(co, n.query))}" target="_blank" rel="noopener">Find ${escapeHtml(n.label)} ↗</a>`,
  ).join(' ')
  const singular = alumLabel.replace(/s$/, '')
  const tie = (p: AlumniRec) => {
    if (p.path === 'ex-colleague') {
      return p.confirmed
        ? `<span class="alum-tie confirmed">✓ ex-${escapeHtml(p.via || 'colleague')}</span>`
        : `<span class="alum-tie unconfirmed">overlap unconfirmed</span>`
    }
    return p.confirmed
      ? `<span class="alum-tie confirmed">✓ ${escapeHtml(p.via || singular)}</span>`
      : `<span class="alum-tie unconfirmed">school unconfirmed</span>`
  }
  const relBadge = (r: string) => `<span class="rel rel-${escapeHtml(r)}">${escapeHtml(r)} fit</span>`
  const blocks = companies.map((co) => {
    const cards = alumni[co].map((p) => `
      <div class="rec">
        <div class="rec-head"><a class="rec-name" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name)} →</a> ${tie(p)} ${relBadge(p.relevance)}</div>
        ${p.title ? `<p class="rec-title">${escapeHtml(p.title)}</p>` : ''}
        ${p.cornell ? `<p class="rec-edu">${escapeHtml(p.cornell)}</p>` : ''}
        ${p.reason ? `<p class="rec-reason">${escapeHtml(p.reason)}</p>` : ''}
        ${p.intro_angle ? `<p class="rec-intro"><b>Intro angle:</b> ${escapeHtml(p.intro_angle)}</p>` : ''}
      </div>`).join('\n')
    return `<div class="alum-co"><h3 class="alum-co-name">${escapeHtml(co)}</h3><div class="cornell-row" style="margin:4px 0 10px">${netLinks(co)}</div>${cards}</div>`
  }).join('\n')
  return `<section class="signal-block">
    <p class="kicker">your networks — vetted warm intros</p>
    <h2>Who to actually reach out to</h2>
    <p class="lede">Real people at your shortlisted firms — every network you belong to (school and past employers), fact-checked for current role and tie, ranked by how useful a warm intro would be, each with a suggested angle.</p>
${blocks}
  </section>`
}

// One-line, data-driven summary of the active shortlist for the page header.
// Replaces the old line that described the pipeline (LinkedIn / triage / etc.) —
// this instead tells the reader what the roles ARE: how many, the disclosed pay
// span, and where. Recomputed on every render so it never drifts from the queue.
function roleSummary(active: QueueEntry[]): string {
  if (!active.length) {
    return 'No active roles in this shortlist right now — the next refresh will repopulate it.'
  }
  // Disclosed pay ranges are embedded in each title, e.g. "… — $163-301K".
  const lows: number[] = []
  const highs: number[] = []
  for (const e of active) {
    const m = e.title.match(/\$(\d+)[–-](\d+)\s*K/i)
    if (m) { lows.push(parseInt(m[1], 10)); highs.push(parseInt(m[2], 10)) }
  }
  const paySpan = lows.length ? `$${Math.min(...lows)}K–$${Math.max(...highs)}K` : null
  const companies = Array.from(new Set(active.map((e) => e.company)))
  const count = active.length

  // Lead with the count + pay span (the two numbers a reader scans for), then
  // ground it in real employers — first three named, the rest rolled into a
  // "+N more" so a long list never becomes a wall of names.
  const roleWord = count === 1 ? 'role' : 'roles'
  const named = companies.slice(0, 3).join(', ')
  const rest = companies.length - 3
  const where = rest > 0 ? `${named} +${rest} more` : named
  const pay = paySpan ? ` spanning ${paySpan}` : ' with the disclosed pay range on each posting'
  return `${count} hand-screened ${roleWord}${pay} at ${where} — each with its salary range, a sourced company brief, and a warm-intro path.`
}

function renderPage(profile: string, entries: QueueEntry[], state: EnrichmentState, apps: { company: string; score: number }[], external: ExternalResult[], confirmedAlumni: Record<string, AlumniRec[]>, fit: Record<string, { score: number }>, networks: Network[]): string {
  const listings = state.listings || {}
  const alumni = state.alumni || {}
  const alumLabel = state.school_label || 'Alumni'
  const school = state.school || 'Cornell University'

  const listed = entries.filter((e) => !listings[e.url] || listings[e.url] === 'ACTIVE')
  const expired = entries.filter((e) => listings[e.url] === 'EXPIRED')

  // Best-fit-first: scored roles ranked by fit, unscored ones (LinkedIn URLs we
  // can't deep-read) keep their queue order below them.
  const fitOf = (e: QueueEntry) => fit[e.url]?.score ?? -1
  const active = [...listed].sort((a, b) => fitOf(b) - fitOf(a))

  const tailoredByCompany = new Map<string, number>()
  apps.forEach((a) => tailoredByCompany.set(a.company, a.score))

  const activeRows = active.map((e, i) => renderRow(
    i + 1, e, alumni[e.company] || [], alumLabel,
    tailoredByCompany.get(e.company) ?? null,
    school,
    fit[e.url]?.score ?? null,
    (confirmedAlumni[e.company] || []).length,
  )).join('\n')

  const closedCards = expired.map((e) => renderClosedCard(e, alumni[e.company] || [], alumLabel, school)).join('\n')

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(profile)} · Shortlist (private)</title>
<style>
  :root { --ink:#1a1a1a;--muted:#6b6b6b;--rule:#e6e6e6;--accent:#8a3a1a;--bg:#fdfaf5;--paper:#fff;--highlight:#f5edd9;--signal-bg:#f4f1ea;--signal-border:#d8cdb5;--cornell:#b21f1f; }
  html,body{background:var(--bg);color:var(--ink);}
  body{font-family:'Charter','Iowan Old Style','Georgia',serif;font-size:17px;line-height:1.55;margin:0;padding:40px 20px 80px;-webkit-font-smoothing:antialiased;}
  main{max-width:800px;margin:0 auto;}
  header.page-head{margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid var(--rule);}
  .kicker{font-family:'Inter',system-ui,sans-serif;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin:0 0 8px;font-weight:700;}
  h1.page-title{font-family:'Charter',serif;font-size:36px;line-height:1.1;margin:0 0 6px;font-weight:500;letter-spacing:-.01em;}
  .summary{color:var(--muted);font-size:15px;line-height:1.6;font-family:'Inter',system-ui,sans-serif;margin:12px 0 0;}
  .stats{display:flex;gap:24px;margin-top:16px;font-family:'Inter',system-ui,sans-serif;font-size:13px;color:var(--muted);}
  .stats b{color:var(--ink);font-weight:700;}
  .row{display:grid;grid-template-columns:36px 1fr auto;column-gap:16px;align-items:start;background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:18px 22px;margin-bottom:12px;}
  .row.tailored{background:var(--highlight);border-color:#d8c89c;}
  .num{font-family:'Inter',system-ui,sans-serif;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.05em;padding-top:4px;}
  .title{font-family:'Charter',serif;font-size:18px;line-height:1.3;margin:0 0 2px;font-weight:600;}
  .company{font-family:'Inter',system-ui,sans-serif;color:var(--muted);font-size:13px;margin:0 0 8px;}
  .badge-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
  .badge{font-family:'Inter',system-ui,sans-serif;font-size:11px;font-weight:600;letter-spacing:.03em;padding:3px 9px;border-radius:99px;}
  .badge.tailored-badge{background:var(--accent);color:#fff;}
  .badge.fit-badge{background:#0f4d7a;color:#fff;}
  .badge.warm-badge{background:#0f7a4d;color:#fff;}
  .cornell-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px;font-family:'Inter',system-ui,sans-serif;font-size:12px;}
  .cornell-label{color:var(--muted);font-weight:600;letter-spacing:.03em;text-transform:uppercase;font-size:10px;margin-right:4px;}
  .cornell-deep-link{display:inline-block;background:#fff;border:1px solid var(--cornell);color:var(--cornell);padding:5px 12px;border-radius:99px;font-size:12px;text-decoration:none;font-weight:600;font-family:'Inter',system-ui,sans-serif;}
  .cornell-deep-link:hover{background:var(--cornell);color:#fff;}
  .apply{background:var(--accent);color:#fff;font-family:'Inter',system-ui,sans-serif;font-size:13px;font-weight:600;letter-spacing:.02em;padding:8px 14px;border-radius:4px;text-decoration:none;white-space:nowrap;}
  .apply:hover{background:#6e2c10;}
  .signal-block{margin-top:56px;padding-top:36px;border-top:1px solid var(--rule);}
  .signal-block .kicker{color:#6b5a3a;margin-bottom:4px;}
  .signal-block h2{font-family:'Charter',serif;font-size:22px;line-height:1.25;margin:0 0 6px;font-weight:600;letter-spacing:-.005em;}
  .signal-block .lede{color:var(--muted);font-size:14px;line-height:1.5;font-family:'Inter',system-ui,sans-serif;margin:0 0 20px;}
  .closed-card{background:var(--signal-bg);border:1px solid var(--signal-border);border-radius:6px;padding:16px 20px;margin-bottom:12px;}
  .closed-title{font-family:'Charter',serif;font-size:16px;margin:0 0 4px;font-weight:600;}
  .closed-meta{font-family:'Inter',system-ui,sans-serif;font-size:12px;color:var(--muted);margin:0 0 8px;}
  .closed-meta a{color:var(--accent);}
  .src-badge{display:inline-block;background:#2a2a2a;color:#fff;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;margin-right:4px;}
  .ext-note{font-family:'Inter',system-ui,sans-serif;font-size:13px;color:var(--ink);margin:8px 0 0;line-height:1.5;}
  .alum-co{background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:14px 20px;margin-bottom:12px;}
  .alum-co-name{font-family:'Charter',serif;font-size:17px;margin:0 0 8px;font-weight:600;}
  .rec{padding:12px 0;border-top:1px solid var(--rule);}
  .rec:first-child{border-top:none;padding-top:4px;}
  .rec-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-family:'Inter',system-ui,sans-serif;}
  .rec-name{color:var(--accent);text-decoration:none;font-weight:700;font-size:15px;}
  .rec-name:hover{text-decoration:underline;}
  .rec-title{font-family:'Inter',system-ui,sans-serif;font-size:13px;color:var(--ink);font-weight:600;margin:4px 0 0;}
  .rec-edu{font-family:'Inter',system-ui,sans-serif;font-size:12px;color:var(--muted);margin:2px 0 0;}
  .rec-reason{font-family:'Inter',system-ui,sans-serif;font-size:13px;color:var(--ink);margin:6px 0 0;line-height:1.5;}
  .rec-intro{font-family:'Inter',system-ui,sans-serif;font-size:12.5px;color:#3a4a2a;background:#f1f4ea;border-radius:4px;padding:6px 10px;margin:6px 0 0;line-height:1.45;}
  .alum-tie{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;}
  .alum-tie.confirmed{background:#0f7a4d;color:#fff;}
  .alum-tie.unconfirmed{background:#eee;color:#777;}
  .rel{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px;}
  .rel-high{background:#8a3a1a;color:#fff;}
  .rel-medium{background:#f0e2cf;color:#7a4a14;}
  .rel-low{background:#eee;color:#666;}
  footer{font-family:'Inter',system-ui,sans-serif;font-size:12px;color:var(--muted);text-align:center;padding-top:24px;}
  @media(max-width:600px){body{padding:20px 12px 40px;}.row{grid-template-columns:28px 1fr;padding:14px 16px;}.apply{grid-column:2;justify-self:start;margin-top:10px;}h1.page-title{font-size:28px;}.title{font-size:16px;}}
</style></head>
<body><main>
  <header class="page-head">
    <p class="kicker">ve-work · private shortlist</p>
    <h1 class="page-title">${active.length} active roles for ${escapeHtml(profile)}</h1>
    <p class="summary">${escapeHtml(roleSummary(active))}</p>
    <div class="stats">
      <span><b>${active.length}</b> active</span>
      <span><b>${apps.length}</b> tailored</span>
      <span>${escapeHtml(alumLabel)} lookup: one-click via LinkedIn (authed session)</span>
    </div>
  </header>
${activeRows}
${renderExternalSection(external)}
${renderAlumniSection(confirmedAlumni, alumLabel, networks)}
  ${expired.length > 0 ? `<section class="signal-block">
    <p class="kicker">company hiring signal</p>
    <h2>Recently closed at companies still hiring in your space</h2>
    <p class="lede">These specific roles closed before you could apply — but the company posted them recently, so they're actively hiring at this level. Worth a warm intro.</p>
${closedCards}
  </section>` : ''}
</main>
<footer>Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · cron refreshes daily 0700 UTC</footer>
</body></html>`
}

function publishToHerenow(profile: string, dir: string, slug: string | null): string {
  const slugArg = slug ? `--slug ${slug}` : ''
  console.log(`  ${profile}: publishing to here.now${slug ? ` (slug=${slug})` : ' (bootstrap — claiming a new slug)'}...`)
  const out = child_process.execSync(
    `bash "${HERENOW_SCRIPT}" "${dir}" ${slugArg} --client claude-code 2>&1 | tail -20`,
    { env: { ...process.env } },
  ).toString()
  console.log(out)
  const slugMatch = out.match(/publish_result\.slug=(\S+)/)
  return slugMatch ? slugMatch[1] : ''
}

function setHerenowPassword(slug: string, password: string): boolean {
  const apiKey = (process.env.HERENOW_API_KEY || '').trim() || readHerenowCredFile()
  if (!apiKey) {
    console.log('  (no here.now API key — skipping password set)')
    return false
  }
  const body = JSON.stringify({ password })
  const res = child_process.execSync(
    `curl -sS -X PATCH "https://here.now/api/v1/publish/${slug}/metadata" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d '${body}'`,
  ).toString()
  return res.includes('"success":true') || res.includes('"passwordProtected":true')
}

function readHerenowCredFile(): string {
  const p = path.join(process.env.HOME || '', '.herenow', 'credentials')
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf-8').trim()
}

function generatePassword(): string {
  // Short, easy-to-share: two random adjective+noun + 4 digits
  const adj = ['quiet', 'warm', 'bright', 'crisp', 'gentle', 'sharp', 'bold', 'amber', 'rapid', 'rare']
  const noun = ['cedar', 'harbor', 'meadow', 'lantern', 'pebble', 'comet', 'velvet', 'orchid', 'falcon', 'maple']
  const a = adj[Math.floor(Math.random() * adj.length)]
  const n = noun[Math.floor(Math.random() * noun.length)]
  const d = String(Math.floor(1000 + Math.random() * 9000))
  return `${a}-${n}-${d}`
}

function writePublishToSearchYaml(profile: string, slug: string, password: string): void {
  const p = path.join(ROOT, 'profiles', profile, 'search.yaml')
  if (!fs.existsSync(p)) return
  const text = fs.readFileSync(p, 'utf-8')
  // Replace any existing publish: block, or append one
  const newBlock = `publish:\n  slug: "${slug}"\n  password: "${password}"`
  const blockRe = /^publish:\s*\n(?:[ \t]+\S+.*\n?)*/m
  const updated = blockRe.test(text)
    ? text.replace(blockRe, newBlock + '\n')
    : text.trimEnd() + '\n\n' + newBlock + '\n'
  fs.writeFileSync(p, updated)
  console.log(`  ${profile}: wrote publish.slug + publish.password to search.yaml`)
}

async function renderProfile(profile: string, doPublish: boolean): Promise<void> {
  const config = readConfig(profile)
  if (!config) { console.log(`  ${profile}: no search.yaml — skipping`); return }
  const entries = readQueueEntries(profile)
  const state = readEnrichment(profile)
  const apps = readApplications(profile)
  const external = readExternal(profile)
  const alumni = readAlumni(profile)
  const fit = readFit(profile)

  const networks = readNetworks(profile, state.school || '', state.school_label || '')
  const html = renderPage(profile, entries, state, apps, external, alumni, fit, networks)
  const outDir = `/tmp/render-${profile}`
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), html)
  console.log(`  ${profile}: wrote ${outDir}/index.html (${(html.length / 1024).toFixed(1)} KB)`)

  // Telegram digest: top 3 active roles by fit, one per line, written as a
  // SINGLE line with literal \n sequences (ship.sh splices it into a JSON
  // string — real newlines or quotes would break the payload).
  const top = entries
    .map((e) => ({ e, score: fit[e.url]?.score ?? -1, warm: (alumni[e.company] || []).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  if (top.length) {
    const clean = (s: string) => s.replace(/["\\]/g, '').slice(0, 70)
    const digest = top
      .map((t, i) => `${i + 1}. ${clean(t.e.title)} @ ${clean(t.e.company)}${t.score >= 0 ? ` · fit ${t.score}/10` : ''}${t.warm ? ` · ${t.warm} warm path${t.warm === 1 ? '' : 's'}` : ''}`)
      .join('\\n')
    fs.writeFileSync(path.join(outDir, 'digest.txt'), digest)
  }

  if (!doPublish) return
  const slug = config.publish?.slug || null
  const existingPassword = config.publish?.password || null
  const claimedSlug = publishToHerenow(profile, outDir, slug)
  if (!slug && claimedSlug) {
    // First publish — generate password, set on here.now, write both back
    const password = existingPassword || generatePassword()
    const ok = setHerenowPassword(claimedSlug, password)
    writePublishToSearchYaml(profile, claimedSlug, password)
    if (ok) console.log(`  ${profile}: here.now password set → ${password}`)
  } else if (slug && !existingPassword) {
    // Slug existed but no password recorded — backfill (idempotent)
    const password = generatePassword()
    const ok = setHerenowPassword(slug, password)
    writePublishToSearchYaml(profile, slug, password)
    if (ok) console.log(`  ${profile}: here.now password backfilled → ${password}`)
  }
}

async function main() {
  const opts = parseArgs()
  const profiles = opts.profile ? [opts.profile] : listProfiles()
  if (profiles.length === 0) { console.log('No profiles found.'); return }
  console.log(`Rendering ${profiles.length} profile(s)...\n`)
  for (const p of profiles) {
    await renderProfile(p, opts.publish)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
