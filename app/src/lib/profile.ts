import * as fs from "fs";
import * as path from "path";

const ROOT = process.env.VE_WORK_ROOT || "/home/exedev/ve-work";

export interface Profile {
  name: string;
  profileMd: string;
  searchYaml: string;
  applicationsMd: string;
  queueEntries: { url: string; title: string; company: string }[];
  outputFiles: string[];
  publish: { slug: string; password: string } | null;
  schoolLabel: string;
  school: string;
  listingStatus: Record<string, "ACTIVE" | "EXPIRED" | "UNKNOWN">;
  tailoredByCompany: Record<string, number>;
  external: ExternalResult[];
  alumniByCompany: Record<string, AlumniPerson[]>;
  companies: CompanyDossier[];
  fitByUrl: Record<string, FitEntry>;
  searchHistory: SearchVersion[];
  decisions: Record<string, Decision>;
  companiesYaml: string;
  networks: NetworkAnchor[];
}

// One warm-path network the candidate belongs to — a school or past employer.
// Sourced from alumni.json (written by enrich-exa) with graph.json as fallback,
// so the chips render even before the first enrichment pass completes.
export interface NetworkAnchor {
  kind: "school" | "employer";
  name: string;
  label: string; // display: "Cornellians", "Pune alumni", "Ex-Mastercard"
}

// A snapshot of a prior shortlist, kept when the search parameters change.
// From profiles/<name>/.enrichment/history.json.
export interface SearchVersion {
  archivedAt: string;
  keywords: string[];
  locations: string[];
  roles: { url: string; title: string; company: string }[];
}

// A JD deep-read + fit score for an off-LinkedIn role. Keyed by URL in
// profiles/<name>/.enrichment/fit.json.
export interface FitEntry {
  url: string;
  title: string;
  score: number;
  requirements: string;
  responsibilities: string;
  matched: string[];
  gaps: string[];
}

// A sourced company profile for review before applying. Lives in
// profiles/<name>/.enrichment/companies.json.
export interface CompanyDossier {
  company: string;
  overview: string;
  employerType: string;
  news: { date: string; title: string; url: string }[];
  deals: { date: string; summary: string; url: string }[];
  talkingPoint?: string;
  sources: string[];
}

// A role found OUTSIDE LinkedIn (company careers page, Indeed, an Exa search, or
// added by hand). Lives in profiles/<name>/external.json.
export interface ExternalResult {
  url: string;
  title: string;
  company: string;
  source: string; // "Company careers", "Indeed", "Exa", "Manual", ...
  location?: string;
  note?: string;
}

// A vetted warm-intro recommendation at a shortlisted company. Pre-judged upstream
// (Exa fact-extraction + relevance scoring): real title, Cornell detail, confirmed
// flag, relevance, a reason and a suggested intro angle. Lives in
// profiles/<name>/.enrichment/alumni.json. The dashboard only ranks + renders.
export interface AlumniPerson {
  name: string;
  url: string;
  title?: string;
  cornell?: string;
  confirmed: boolean;
  relevance: "high" | "medium" | "low";
  reason?: string;
  introAngle?: string;
  path?: "alumni" | "ex-colleague"; // which kind of warm tie
  via?: string; // the school or past company behind the tie
}

// A user decision on a queued role, made from the dashboard. Stored in
// profiles/<name>/decisions.json so cron re-renders and the pipeline can see it.
export interface Decision {
  status: "applied" | "skipped" | "starred";
  at: string;
  note?: string;
}

function extractYamlField(yaml: string, parent: string, child: string): string | null {
  // naive — looks for "<parent>:" line followed by indented "<child>: <value>"
  const lines = yaml.split("\n");
  let inParent = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^\S/.test(line)) {
      inParent = line.startsWith(`${parent}:`);
      continue;
    }
    if (!inParent) continue;
    const m = line.match(new RegExp(`^\\s+${child}:\\s*["']?([^"'\\n]*?)["']?\\s*$`));
    if (m) return m[1].trim();
  }
  return null;
}

export function listProfiles(): string[] {
  const dir = path.join(ROOT, "profiles");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "example")
    .map((d) => d.name);
}

export function readProfile(name: string): Profile | null {
  const dir = path.join(ROOT, "profiles", name);
  if (!fs.existsSync(dir)) return null;
  const read = (file: string) => {
    const p = path.join(dir, file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  };
  const searchYaml = read("search.yaml");
  const slug = extractYamlField(searchYaml, "publish", "slug");
  const password = extractYamlField(searchYaml, "publish", "password");
  const applicationsMd = read("applications.md");
  const enrichment = readEnrichment(name);
  return {
    name,
    profileMd: read("profile.md"),
    searchYaml,
    applicationsMd,
    queueEntries: readQueueEntries(name),
    outputFiles: listOutput(name),
    publish: slug ? { slug, password: password || "" } : null,
    schoolLabel: enrichment.school_label || extractYamlField(searchYaml, "alumni_network", "label") || "Alumni",
    school: enrichment.school || extractYamlField(searchYaml, "alumni_network", "school") || "",
    listingStatus: enrichment.listings || {},
    tailoredByCompany: parseTailoredEntries(applicationsMd),
    external: readExternal(name),
    alumniByCompany: readAlumni(name),
    companies: readCompanies(name),
    fitByUrl: readFit(name),
    searchHistory: readSearchHistory(name),
    decisions: readDecisions(name),
    companiesYaml: readCompaniesYaml(name),
    networks: readNetworks(name, enrichment.school_label, extractYamlField(searchYaml, "alumni_network", "school")),
  };
}

function networkLabel(kind: "school" | "employer", anchor: string, configured?: { school?: string | null; label?: string | null }): string {
  if (kind === "employer") return `Ex-${anchor}`;
  // Preserve a hand-configured label ("Cornellians") for the configured school.
  if (configured?.label && configured.school && anchor.toLowerCase().startsWith(configured.school.toLowerCase().split(",")[0])) {
    return configured.label;
  }
  return `${anchor.split(",")[0].replace(/\s+(university|college|institute|school)( of.*)?$/i, "").trim()} alumni`;
}

function readNetworks(profile: string, configuredLabel?: string, configuredSchool?: string | null): NetworkAnchor[] {
  const configured = { school: configuredSchool, label: configuredLabel };
  const out: NetworkAnchor[] = [];
  const seen = new Set<string>();
  const add = (kind: "school" | "employer", name: string) => {
    const key = `${kind}:${name.toLowerCase()}`;
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push({ kind, name, label: networkLabel(kind, name, configured) });
  };
  const alumniPath = path.join(ROOT, "profiles", profile, ".enrichment", "alumni.json");
  try {
    const raw = JSON.parse(fs.readFileSync(alumniPath, "utf-8"));
    (raw.schools || []).forEach((s: string) => add("school", s));
    (raw.past_companies || []).forEach((c: string) => add("employer", c));
  } catch { /* fall through to graph */ }
  if (out.length === 0) {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(ROOT, "profiles", profile, ".enrichment", "graph.json"), "utf-8"));
      (g.schools || []).forEach((s: { name: string }) => add("school", s.name));
      (g.employers || []).filter((e: { current: boolean }) => !e.current).slice(0, 3)
        .forEach((e: { name: string }) => add("employer", e.name));
    } catch { /* no enrichment yet */ }
  }
  return out;
}

function readSearchHistory(profile: string): SearchVersion[] {
  const p = path.join(ROOT, "profiles", profile, ".enrichment", "history.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return ((raw.versions as Record<string, unknown>[]) || []).map((v) => ({
      archivedAt: String(v.archived_at || ""),
      keywords: Array.isArray(v.keywords) ? (v.keywords as string[]) : [],
      locations: Array.isArray(v.locations) ? (v.locations as string[]) : [],
      roles: Array.isArray(v.roles) ? (v.roles as SearchVersion["roles"]) : [],
    }));
  } catch {
    return [];
  }
}

function readFit(profile: string): Record<string, FitEntry> {
  const p = path.join(ROOT, "profiles", profile, ".enrichment", "fit.json");
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return (raw.by_url || {}) as Record<string, FitEntry>;
  } catch {
    return {};
  }
}

function readCompanies(profile: string): CompanyDossier[] {
  const p = path.join(ROOT, "profiles", profile, ".enrichment", "companies.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Object.entries<Record<string, unknown>>(raw.by_company || {}).map(([company, v]) => ({
      company,
      overview: String(v.overview || ""),
      employerType: String(v.employer_type || ""),
      news: Array.isArray(v.news) ? (v.news as CompanyDossier["news"]) : [],
      deals: Array.isArray(v.deals) ? (v.deals as CompanyDossier["deals"]) : [],
      talkingPoint: v.talking_point ? String(v.talking_point) : undefined,
      sources: Array.isArray(v.sources) ? (v.sources as string[]) : [],
    }));
  } catch {
    return [];
  }
}

function readExternal(profile: string): ExternalResult[] {
  const p = path.join(ROOT, "profiles", profile, "external.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(raw) ? raw : raw.results || [];
  } catch {
    return [];
  }
}

export function addExternalResult(name: string, r: ExternalResult): void {
  const p = path.join(ROOT, "profiles", name, "external.json");
  const cur = readExternal(name);
  cur.unshift(r);
  fs.writeFileSync(p, JSON.stringify(cur, null, 2));
}

function readAlumni(profile: string): Record<string, AlumniPerson[]> {
  const p = path.join(ROOT, "profiles", profile, ".enrichment", "alumni.json");
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    const rel: Record<string, number> = { high: 2, medium: 1, low: 0 };
    // Mirrors pi/enrich-exa.ts warmPathScore: confirmed dominates (any verified
    // contact beats every unverified one), ex-colleague edges out alumni.
    const score = (x: AlumniPerson) =>
      (x.confirmed ? 6 : 0) + (x.path === "ex-colleague" ? 1 : 0) + (rel[x.relevance] ?? 0);
    const out: Record<string, AlumniPerson[]> = {};
    for (const [company, people] of Object.entries<Record<string, unknown>[]>(
      raw.by_company || {}
    )) {
      out[company] = people
        .map((person) => ({
          name: String(person.name || ""),
          url: String(person.url || ""),
          title: person.title ? String(person.title) : undefined,
          cornell: person.cornell ? String(person.cornell) : undefined,
          confirmed: Boolean(person.confirmed),
          relevance: (person.relevance || "low") as AlumniPerson["relevance"],
          reason: person.reason ? String(person.reason) : undefined,
          introAngle: person.intro_angle ? String(person.intro_angle) : undefined,
          path: (person.path === "ex-colleague" ? "ex-colleague" : person.path === "alumni" ? "alumni" : undefined) as AlumniPerson["path"],
          via: person.via ? String(person.via) : undefined,
        }))
        .sort((a, b) => score(b) - score(a));
    }
    return out;
  } catch {
    return {};
  }
}

interface EnrichmentState {
  school?: string;
  school_label?: string;
  listings?: Record<string, "ACTIVE" | "EXPIRED" | "UNKNOWN">;
}

function readEnrichment(profile: string): EnrichmentState {
  const p = path.join(ROOT, "profiles", profile, ".enrichment", "state.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function parseTailoredEntries(applicationsMd: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const section of applicationsMd.split(/^##\s+/m)) {
    const titleM = section.match(/^(.+?)\s+—\s+/);
    if (!titleM) continue;
    const scoreM = section.match(/\*\*Match Score:\*\*\s+(\d+)/);
    if (scoreM) out[titleM[1].trim()] = parseInt(scoreM[1], 10);
  }
  return out;
}

function readQueueEntries(profile: string) {
  const queue = path.join(ROOT, "jobs", "queue.md");
  if (!fs.existsSync(queue)) return [];
  const text = fs.readFileSync(queue, "utf-8");
  let inProcessed = false;
  const out: { url: string; title: string; company: string }[] = [];
  for (const raw of text.split("\n")) {
    const s = raw.trim().toLowerCase();
    if (s === "## queue") {
      inProcessed = false;
      continue;
    }
    if (s === "## processed") {
      inProcessed = true;
      continue;
    }
    if (inProcessed) continue;
    const m = raw.match(/^(https?:\/\/\S+)\s*\|\s*profile=(\S+)\s+<!--\s*(.+?)\s+@\s+(.+?)\s*-->/);
    if (!m || m[2] !== profile) continue;
    out.push({ url: m[1], title: m[3], company: m[4] });
  }
  return out;
}

function listOutput(profile: string): string[] {
  const dir = path.join(ROOT, "profiles", profile, "output");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
}

export function writeProfileMd(name: string, content: string): void {
  const p = path.join(ROOT, "profiles", name, "profile.md");
  fs.writeFileSync(p, content);
}

export function writeSearchYaml(name: string, content: string): void {
  const p = path.join(ROOT, "profiles", name, "search.yaml");
  fs.writeFileSync(p, content);
}

// ── Companies watchlist (profiles/<name>/companies.yaml) ─────────────────────
// Plain `companies:` YAML list. pi/discover.ts polls these companies' ATS
// boards every run, in addition to queue + alumni-cluster companies.

export function readCompaniesYaml(name: string): string {
  const p = path.join(ROOT, "profiles", name, "companies.yaml");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
}

export function writeCompaniesYaml(name: string, content: string): void {
  fs.writeFileSync(path.join(ROOT, "profiles", name, "companies.yaml"), content);
}

// ── Dashboard decisions (profiles/<name>/decisions.json) ─────────────────────

export function readDecisions(name: string): Record<string, Decision> {
  const p = path.join(ROOT, "profiles", name, "decisions.json");
  if (!fs.existsSync(p)) return {};
  try {
    return (JSON.parse(fs.readFileSync(p, "utf-8")).by_url || {}) as Record<string, Decision>;
  } catch {
    return {};
  }
}

export function recordDecision(name: string, url: string, d: Decision | null): void {
  const p = path.join(ROOT, "profiles", name, "decisions.json");
  const byUrl = readDecisions(name);
  if (d === null) delete byUrl[url];
  else byUrl[url] = d;
  fs.writeFileSync(p, JSON.stringify({ by_url: byUrl }, null, 2));
}

// Move a queued role to ## Processed with a skip annotation — the same shape
// pi/triage.ts writes, so dedup and history treat dashboard skips identically.
export function skipQueueEntry(name: string, url: string, reason: string): boolean {
  const queue = path.join(ROOT, "jobs", "queue.md");
  if (!fs.existsSync(queue)) return false;
  const lines = fs.readFileSync(queue, "utf-8").split("\n");
  let inQueue = false;
  let moved: string | null = null;
  const kept: string[] = [];
  for (const raw of lines) {
    const s = raw.trim().toLowerCase();
    if (s === "## queue") inQueue = true;
    else if (s === "## processed") inQueue = false;
    if (inQueue && moved === null && raw.startsWith(url + " ") && raw.includes(`profile=${name}`)) {
      moved = `${raw}  <!-- skipped: ${reason.replace(/-->/g, "").slice(0, 80)} -->`;
      continue;
    }
    kept.push(raw);
  }
  if (!moved) return false;
  const idx = kept.findIndex((l) => l.trim().toLowerCase() === "## processed");
  if (idx === -1) return false;
  kept.splice(idx + 1, 0, moved);
  fs.writeFileSync(queue, kept.join("\n"));
  return true;
}

// Append an applications.md entry when the user marks a role applied from the
// dashboard. Same `## Company — Title` header shape the tracker agent writes.
export function appendApplication(name: string, url: string, title: string, company: string): void {
  const p = path.join(ROOT, "profiles", name, "applications.md");
  const stamp = new Date().toISOString().slice(0, 10);
  const entry = `\n## ${company} — ${title}\n**URL:** ${url}\n**Date:** ${stamp}\n**Status:** Applied (marked via dashboard)\n`;
  fs.appendFileSync(p, entry);
}

// ── Onboarding preferences (profiles/<name>/.enrichment/prefs.json) ──────────
// Collected by the onboarding wizard. comp.floor is the SEARCH floor — the
// stated minimum plus an uplift the pipeline aims at so discovered roles have
// negotiation headroom. It is intentionally never rendered anywhere in the UI.

export interface Prefs {
  generated_at?: string;
  linkedin_url?: string;
  availability?: string;
  comp?: { stated: number; currency: string; floor: number; uplift: number };
  hard_nos?: string[];
  stage?: string; // startup | scaleup | enterprise | any
  sponsorship_needed?: boolean;
  outreach_tone?: string; // warm | direct | formal
  telegram_chat?: string;
}

export function readPrefs(name: string): Prefs {
  const p = path.join(ROOT, "profiles", name, ".enrichment", "prefs.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Prefs;
  } catch {
    return {};
  }
}

export function writePrefs(name: string, prefs: Prefs): void {
  const dir = path.join(ROOT, "profiles", name, ".enrichment");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "prefs.json"), JSON.stringify(prefs, null, 2));
}

// ── Pipeline status + runner (pi/) ───────────────────────────────────────────

export interface PipelineStatus {
  lastSuccess: number | null; // unix seconds
  running: "discover" | "refresh" | null;
  logTail: string[];
}

const UI_PID = path.join(ROOT, "pi", ".ui-run.pid");
const UI_LOG = path.join(ROOT, "pi", "ui-run.log");

function uiRunning(): "discover" | "refresh" | null {
  try {
    const [pid, step] = fs.readFileSync(UI_PID, "utf-8").trim().split(" ");
    process.kill(Number(pid), 0); // throws if the process is gone
    return step === "discover" ? "discover" : "refresh";
  } catch {
    return null;
  }
}

export function pipelineStatus(): PipelineStatus {
  let lastSuccess: number | null = null;
  try {
    lastSuccess = parseInt(fs.readFileSync(path.join(ROOT, "pi", ".last-success"), "utf-8").trim(), 10) || null;
  } catch { /* never ran */ }
  const running = uiRunning();
  let logTail: string[] = [];
  const logPath = running ? UI_LOG : path.join(ROOT, "pi", "cron.log");
  try {
    logTail = fs.readFileSync(logPath, "utf-8").trimEnd().split("\n").slice(-10);
  } catch { /* no log yet */ }
  return { lastSuccess, running, logTail };
}

// Launch a pipeline step detached so it survives the request. "refresh" re-runs
// enrichment + fit + render only (no new discovery, no Apify quota); "discover"
// runs the full twice-daily chain.
export function startPipeline(step: "discover" | "refresh"): { ok: boolean; error?: string } {
  if (uiRunning()) return { ok: false, error: "a run is already in progress" };
  const cmd =
    step === "discover"
      ? "bash pi/run-pipeline.sh"
      : "set -a && . ./.env && set +a && /bin/npm run enrich-exa --silent && /bin/npm run jd-fit --silent && /bin/npm run render --silent";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require("child_process") as typeof import("child_process");
  const fd = fs.openSync(UI_LOG, "w");
  const child = spawn("bash", ["-c", `cd "${ROOT}" && ${cmd}; echo "ui-run: ${step} finished (exit $?)"`], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  fs.closeSync(fd);
  if (!child.pid) return { ok: false, error: "failed to spawn" };
  fs.writeFileSync(UI_PID, `${child.pid} ${step}`);
  child.on("exit", () => { try { fs.unlinkSync(UI_PID); } catch { /* already gone */ } });
  child.unref();
  return { ok: true };
}

// First-time onboarding: pi/onboard.sh creates the profile dir, parses the
// LinkedIn PDF (gateway LLM), writes search.yaml, runs the first render and
// claims a here.now slug. Spawn-array args — no shell, no injection surface.
export function startOnboard(
  profile: string,
  pdfPath: string,
  keywords: string,
  locations: string,
  telegramChat?: string,
): { ok: boolean; error?: string } {
  if (uiRunning()) return { ok: false, error: "a run is already in progress" };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require("child_process") as typeof import("child_process");
  const args = [
    "pi/onboard.sh",
    `--name=${profile}`,
    `--pdf=${pdfPath}`,
    `--keywords=${keywords}`,
    `--locations=${locations}`,
  ];
  if (telegramChat) args.push(`--telegram-chat=${telegramChat}`);
  const fd = fs.openSync(UI_LOG, "w");
  const child = spawn("bash", args, { cwd: ROOT, detached: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  if (!child.pid) return { ok: false, error: "failed to spawn" };
  fs.writeFileSync(UI_PID, `${child.pid} refresh`);
  child.on("exit", () => { try { fs.unlinkSync(UI_PID); } catch { /* already gone */ } });
  child.unref();
  return { ok: true };
}
