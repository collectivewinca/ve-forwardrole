"use client";

import { useState } from "react";
import { RoleCard } from "./RoleCard";
import { AddExternalForm } from "./AddExternalForm";
import type { ExternalResult, AlumniPerson, CompanyDossier, FitEntry, SearchVersion, Decision } from "@/lib/profile";

type Entry = { url: string; title: string; company: string };
type TabId = "shortlist" | "external" | "alumni" | "companies" | "history";

interface Props {
  profile: string;
  active: Entry[];
  expired: Entry[];
  external: ExternalResult[];
  alumniByCompany: Record<string, AlumniPerson[]>;
  companies: CompanyDossier[];
  fitByUrl: Record<string, FitEntry>;
  searchHistory: SearchVersion[];
  school: string;
  schoolLabel: string;
  listingStatus: Record<string, "ACTIVE" | "EXPIRED" | "UNKNOWN">;
  tailoredByCompany: Record<string, number>;
  decisions: Record<string, Decision>;
}

function confirmedCount(a: Record<string, AlumniPerson[]>): number {
  return Object.values(a).reduce((n, ppl) => n + ppl.filter((p) => p.confirmed).length, 0);
}

function alumniSearchUrl(company: string, school: string): string {
  const q = encodeURIComponent(`${company} ${school}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

export function DashboardTabs(props: Props) {
  const [tab, setTab] = useState<TabId>("shortlist");
  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "shortlist", label: "Shortlist", count: props.active.length },
    { id: "external", label: "Other sources", count: props.external.length },
    { id: "alumni", label: props.schoolLabel, count: confirmedCount(props.alumniByCompany) },
    { id: "companies", label: "Companies", count: props.companies.length },
    { id: "history", label: "History", count: props.searchHistory.length },
  ];

  return (
    <div className="mt-10">
      <div className="flex gap-1 border-b border-zinc-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id
                ? "border-orange-900 text-orange-900"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t.label}
            <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "shortlist" && <ShortlistPanel {...props} />}
        {tab === "external" && <ExternalPanel {...props} />}
        {tab === "alumni" && <AlumniPanel {...props} />}
        {tab === "companies" && <CompaniesPanel companies={props.companies} />}
        {tab === "history" && <HistoryPanel versions={props.searchHistory} />}
      </div>
    </div>
  );
}

function ShortlistPanel(props: Props) {
  // Starred first, then by JD-fit score, then queue order. Skipped roles are
  // hidden (their queue.md line has already moved to ## Processed).
  const rank = (e: Entry) => {
    const d = props.decisions[e.url];
    if (d?.status === "starred") return 1000 + (props.fitByUrl[e.url]?.score ?? 0);
    return props.fitByUrl[e.url]?.score ?? -1;
  };
  const visible = props.active
    .filter((e) => props.decisions[e.url]?.status !== "skipped")
    .sort((a, b) => rank(b) - rank(a));
  return (
    <>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
        {visible.length} active role{visible.length === 1 ? "" : "s"} — starred first, then best fit
      </h2>
      <div className="grid gap-2">
        {visible.map((e, i) => (
          <RoleCard
            key={e.url}
            index={i + 1}
            profile={props.profile}
            url={e.url}
            title={e.title}
            company={e.company}
            status={props.listingStatus[e.url]}
            schoolLabel={props.schoolLabel}
            school={props.school}
            matchScore={props.tailoredByCompany[e.company]}
            fit={props.fitByUrl[e.url]}
            warmCount={(props.alumniByCompany[e.company] || []).filter((p) => p.confirmed).length}
            decision={props.decisions[e.url]}
          />
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-zinc-500">No active roles yet. Cron runs at 0700 and 1900 UTC.</p>
        )}
      </div>

      {props.expired.length > 0 && (
        <div className="mt-10 border-t border-zinc-200 pt-8">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-600">
            Recently closed — companies still hiring in your space
          </h2>
          <p className="mb-3 text-xs text-zinc-500">
            The role closed before you applied, but the company is still hiring at this level — worth a warm intro.
          </p>
          <div className="grid gap-2">
            {props.expired.map((e, i) => (
              <RoleCard
                key={e.url}
                index={i + 1}
                profile={props.profile}
                url={e.url}
                title={e.title}
                company={e.company}
                status={props.listingStatus[e.url]}
                schoolLabel={props.schoolLabel}
                school={props.school}
                matchScore={props.tailoredByCompany[e.company]}
                warmCount={(props.alumniByCompany[e.company] || []).filter((p) => p.confirmed).length}
                decision={props.decisions[e.url]}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ExternalPanel(props: Props) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">
          Roles found outside LinkedIn
        </h2>
        <AddExternalForm profile={props.profile} />
      </div>
      <div className="grid gap-2">
        {props.external.map((e) => (
          <article
            key={e.url}
            className="grid grid-cols-[1fr_auto] items-start gap-4 rounded-md border border-zinc-200 bg-white px-4 py-4"
          >
            <div className="min-w-0">
              <h3 className="font-serif text-base font-semibold leading-tight">{e.title}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">@ {e.company}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
                  {e.source}
                </span>
                {e.location && <span className="text-[11px] text-zinc-500">{e.location}</span>}
                {props.school && (
                  <a
                    href={alumniSearchUrl(e.company, props.school)}
                    target="_blank"
                    rel="noopener"
                    className="rounded-full border border-red-700 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-700 hover:text-white"
                  >
                    Find {props.schoolLabel} at {e.company} ↗
                  </a>
                )}
                {props.fitByUrl[e.url] && (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${fitCls(props.fitByUrl[e.url].score)}`}>
                    Fit {props.fitByUrl[e.url].score}/10
                  </span>
                )}
              </div>
              {e.note && <p className="mt-2 text-xs text-zinc-600">{e.note}</p>}
              {props.fitByUrl[e.url] && <FitDetails fit={props.fitByUrl[e.url]} />}
            </div>
            <a
              href={e.url}
              target="_blank"
              rel="noopener"
              className="whitespace-nowrap rounded-md bg-orange-900 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-950"
            >
              View ↗
            </a>
          </article>
        ))}
        {props.external.length === 0 && (
          <p className="text-sm text-zinc-500">
            Nothing here yet. Add a role from a company careers page, Indeed, or any board — it lives alongside your LinkedIn shortlist.
          </p>
        )}
      </div>
    </>
  );
}

function srcHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

function fitCls(score: number): string {
  if (score >= 7) return "bg-emerald-700 text-white";
  if (score >= 4) return "bg-amber-100 text-amber-800";
  return "bg-zinc-200 text-zinc-600";
}

function FitDetails({ fit }: { fit: FitEntry }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-orange-900">
        JD fit — {fit.matched.length} match{fit.matched.length === 1 ? "" : "es"}, {fit.gaps.length} gap{fit.gaps.length === 1 ? "" : "s"}
      </summary>
      <div className="mt-2 grid gap-2 text-xs">
        {fit.requirements && (
          <p className="text-zinc-600"><b className="text-zinc-800">Must-haves:</b> {fit.requirements}</p>
        )}
        {fit.responsibilities && (
          <p className="text-zinc-600"><b className="text-zinc-800">Owns:</b> {fit.responsibilities}</p>
        )}
        {fit.matched.length > 0 && (
          <p className="text-emerald-800">✓ You match: {fit.matched.join("; ")}</p>
        )}
        {fit.gaps.length > 0 && (
          <p className="text-amber-800">△ Gaps to address: {fit.gaps.join("; ")}</p>
        )}
      </div>
    </details>
  );
}

function HistoryPanel({ versions }: { versions: SearchVersion[] }) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No past searches yet. When your search keywords or locations change, the previous shortlist is
        archived here so you never lose it.
      </p>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-xs leading-relaxed text-zinc-500">
        Each time your search parameters change, the prior shortlist is saved here — so you can always
        look back at earlier targeting and reopen those roles.
      </p>
      {versions.map((v, i) => (
        <section key={i} className="rounded-lg border border-zinc-200 bg-zinc-50 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-serif text-base font-semibold">
              Previous search{i === 0 ? " (most recent)" : ""}
            </h3>
            <span className="font-mono text-[11px] text-zinc-400">archived {v.archivedAt}</span>
          </div>
          {v.keywords.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              <b className="text-zinc-700">Keywords:</b> {v.keywords.join(" · ")}
              {v.locations.length > 0 && (
                <>
                  {"  |  "}
                  <b className="text-zinc-700">Locations:</b> {v.locations.join(", ")}
                </>
              )}
            </p>
          )}
          <ul className="mt-3 grid gap-1">
            {v.roles.map((r, j) => (
              <li key={j} className="text-[13px] text-zinc-700">
                <span className="mr-2 font-mono text-[11px] text-zinc-400">{String(j + 1).padStart(2, "0")}</span>
                <a href={r.url} target="_blank" rel="noopener" className="font-medium text-orange-900 hover:underline">
                  {r.title}
                </a>
                <span className="text-zinc-500"> @ {r.company}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CompaniesPanel({ companies }: { companies: CompanyDossier[] }) {
  if (companies.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No company dossiers yet. The enrichment pass builds one per shortlisted company.
      </p>
    );
  }
  return (
    <div className="grid gap-6">
      <p className="text-xs leading-relaxed text-zinc-500">
        A sourced profile of each shortlisted company — what they do, recent news and deals, and a tailoring
        angle. Review before you apply; every item links its source.
      </p>
      {companies.map((c) => (
        <section key={c.company} className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-lg font-semibold">{c.company}</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                c.employerType.startsWith("Direct") ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
              }`}
            >
              {c.employerType}
            </span>
          </div>
          {c.overview && <p className="mt-2 text-[13px] leading-relaxed text-zinc-700">{c.overview}</p>}
          {c.talkingPoint && (
            <p className="mt-3 rounded bg-[#f1f4ea] px-3 py-2 text-[13px] leading-snug text-[#3a4a2a]">
              <b>Tailoring angle:</b> {c.talkingPoint}
            </p>
          )}
          {c.deals.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Deals &amp; contracts</p>
              <ul className="mt-1 grid gap-1">
                {c.deals.map((d, i) => (
                  <li key={i} className="text-[13px] text-zinc-700">
                    {d.date && <span className="mr-2 font-mono text-[11px] text-zinc-400">{d.date}</span>}
                    {d.summary}{" "}
                    <a href={d.url} target="_blank" rel="noopener" className="text-orange-900 hover:underline">↗</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.news.length > 0 && (
            <div className="mt-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Recent news</p>
              <ul className="mt-1 grid gap-1">
                {c.news.map((n, i) => (
                  <li key={i} className="text-[13px]">
                    {n.date && <span className="mr-2 font-mono text-[11px] text-zinc-400">{n.date}</span>}
                    <a href={n.url} target="_blank" rel="noopener" className="text-orange-900 hover:underline">
                      {n.title || srcHost(n.url)} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {c.sources.length > 0 && (
            <p className="mt-3 text-[11px] text-zinc-400">
              Sources:{" "}
              {c.sources.map((s, i) => (
                <span key={i}>
                  {i > 0 ? ", " : ""}
                  <a href={s} target="_blank" rel="noopener" className="underline hover:text-zinc-700">
                    {srcHost(s)}
                  </a>
                </span>
              ))}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function AlumniPanel(props: Props) {
  const companies = Object.keys(props.alumniByCompany);
  if (companies.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No {props.schoolLabel} recommendations yet. The enrichment pass populates this per shortlisted company.
      </p>
    );
  }
  return (
    <div className="grid gap-8">
      <p className="text-xs leading-relaxed text-zinc-500">
        Real people at your shortlisted firms — fact-checked for current role and {props.schoolLabel} tie,
        ranked by how useful a warm intro would be, each with a suggested angle. Not a keyword search.
      </p>
      {companies.map((co) => (
        <section key={co}>
          <div className="flex items-baseline justify-between">
            <h3 className="font-serif text-lg font-semibold">{co}</h3>
            {props.school && (
              <a
                href={alumniSearchUrl(co, props.school)}
                target="_blank"
                rel="noopener"
                className="text-xs text-zinc-400 hover:text-zinc-700"
              >
                search more ↗
              </a>
            )}
          </div>
          <div className="mt-2 grid gap-2">
            {props.alumniByCompany[co].map((p) => (
              <PersonRow key={p.url} p={p} schoolLabel={props.schoolLabel} profile={props.profile} company={co} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PersonRow({ p, schoolLabel, profile, company }: { p: AlumniPerson; schoolLabel: string; profile: string; company: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [copied, setCopied] = useState(false);
  const relCls =
    p.relevance === "high"
      ? "bg-orange-900 text-white"
      : p.relevance === "medium"
        ? "bg-amber-100 text-amber-800"
        : "bg-zinc-100 text-zinc-600";
  const singular = schoolLabel.replace(/s$/, "");
  const tieLabel = p.path === "ex-colleague" ? `ex-${p.via || "colleague"}` : p.via || singular;

  async function draftOutreach() {
    if (drafting) return;
    setDrafting(true);
    const res = await fetch(`/work/api/outreach/${profile}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: p.name, title: p.title, company, path: p.path, via: p.via, introAngle: p.introAngle }),
    }).catch(() => null);
    setDrafting(false);
    if (!res?.ok) {
      setDraft("Draft failed — the LLM gateway didn't answer. Try again in a minute.");
      return;
    }
    const d = await res.json();
    setDraft(String(d.draft || ""));
  }

  async function copy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <article className="rounded-md border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={p.url}
          target="_blank"
          rel="noopener"
          className="text-sm font-bold text-orange-900 hover:underline"
        >
          {p.name} ↗
        </a>
        {p.confirmed ? (
          <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            ✓ {tieLabel}
          </span>
        ) : (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            tie unconfirmed
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${relCls}`}>
          {p.relevance} fit
        </span>
        <button
          onClick={draftOutreach}
          disabled={drafting}
          className="ml-auto rounded-md bg-orange-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-orange-950 disabled:opacity-50"
        >
          {drafting ? "Drafting…" : draft ? "Redraft" : "Draft outreach"}
        </button>
      </div>
      {p.title && <p className="mt-1 text-[13px] font-semibold text-zinc-800">{p.title}</p>}
      {p.cornell && <p className="text-xs text-zinc-500">{p.cornell}</p>}
      {p.reason && <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-700">{p.reason}</p>}
      {p.introAngle && (
        <p className="mt-1.5 rounded bg-[#f1f4ea] px-2.5 py-1.5 text-xs leading-snug text-[#3a4a2a]">
          <b>Intro angle:</b> {p.introAngle}
        </p>
      )}
      {draft && (
        <div className="mt-2 rounded border border-orange-200 bg-orange-50 p-2.5">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800">{draft}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={copy}
              className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-zinc-900"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <span className="text-[11px] text-zinc-500">{draft.length} chars (LinkedIn invite limit: 300)</span>
          </div>
        </div>
      )}
    </article>
  );
}
