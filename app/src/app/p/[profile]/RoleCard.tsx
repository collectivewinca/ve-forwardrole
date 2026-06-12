"use client";

import { useState } from "react";
import type { Decision, FitEntry } from "@/lib/profile";

export interface RoleCardProps {
  index: number;
  profile: string;
  url: string;
  title: string;
  company: string;
  status: "ACTIVE" | "EXPIRED" | "UNKNOWN" | undefined;
  schoolLabel: string;
  school: string;
  matchScore?: number;
  fit?: FitEntry;
  warmCount?: number;
  decision?: Decision;
}

function alumniSearchUrl(company: string, school: string): string {
  const q = encodeURIComponent(`${company} ${school}`);
  return `https://www.linkedin.com/search/results/people/?keywords=${q}&origin=GLOBAL_SEARCH_HEADER`;
}

function fitCls(score: number): string {
  if (score >= 7) return "bg-emerald-700 text-white";
  if (score >= 4) return "bg-amber-100 text-amber-800";
  return "bg-zinc-200 text-zinc-600";
}

export function RoleCard({
  index,
  profile,
  url,
  title,
  company,
  status,
  schoolLabel,
  school,
  matchScore,
  fit,
  warmCount,
  decision,
}: RoleCardProps) {
  const [state, setState] = useState<Decision["status"] | "hidden" | null>(decision?.status ?? null);
  const [busy, setBusy] = useState(false);
  const isExpired = status === "EXPIRED";
  const isTailored = matchScore !== undefined;

  async function act(action: "skip" | "applied" | "star" | "unstar") {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/work/api/queue/${profile}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, action, title, company }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    if (action === "skip") setState("hidden");
    else if (action === "applied") setState("applied");
    else setState(action === "star" ? "starred" : null);
  }

  if (state === "hidden") return null;

  const ringClass =
    state === "applied"
      ? "border-emerald-300 bg-emerald-50"
      : state === "starred"
        ? "border-orange-300 bg-orange-50"
        : isTailored
          ? "border-amber-300 bg-amber-50"
          : "border-zinc-200 bg-white";

  const btn = "rounded px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40";
  return (
    <article
      className={`grid grid-cols-[28px_1fr_auto] items-start gap-4 rounded-md border px-4 py-4 ${ringClass} ${isExpired ? "opacity-60" : ""}`}
    >
      <div className="pt-1 font-mono text-xs font-bold text-zinc-500">
        {String(index).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <h3 className="font-serif text-base font-semibold leading-tight">{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500">@ {company}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {state === "applied" && (
            <span className="rounded-full bg-emerald-700 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              Applied
            </span>
          )}
          {isTailored && (
            <span className="rounded-full bg-orange-900 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
              Match {matchScore}/10 · tailored
            </span>
          )}
          {fit && (
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${fitCls(fit.score)}`}>
              Fit {fit.score}/10
            </span>
          )}
          {(warmCount ?? 0) > 0 && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
              {warmCount} warm path{warmCount === 1 ? "" : "s"}
            </span>
          )}
          {isExpired && (
            <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-red-700">
              No longer accepting
            </span>
          )}
        </div>
        {fit && (fit.matched.length > 0 || fit.gaps.length > 0) && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-orange-900">
              JD fit — {fit.matched.length} match{fit.matched.length === 1 ? "" : "es"}, {fit.gaps.length} gap{fit.gaps.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 grid gap-1 text-xs">
              {fit.matched.length > 0 && <p className="text-emerald-800">✓ {fit.matched.join("; ")}</p>}
              {fit.gaps.length > 0 && <p className="text-amber-800">△ {fit.gaps.join("; ")}</p>}
            </div>
          </details>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener"
          className={`whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${
            isExpired ? "bg-zinc-400 text-white" : "bg-orange-900 text-white hover:bg-orange-950"
          }`}
        >
          {isExpired ? "View ↗" : "Apply ↗"}
        </a>
        <div className="flex gap-1">
          <button
            disabled={busy}
            onClick={() => act(state === "starred" ? "unstar" : "star")}
            title={state === "starred" ? "Unstar" : "Star — keep at the top"}
            className={`${btn} ${state === "starred" ? "bg-orange-200 text-orange-900" : "bg-zinc-100 text-zinc-600 hover:bg-orange-100"}`}
          >
            {state === "starred" ? "★" : "☆"}
          </button>
          {state !== "applied" && (
            <button
              disabled={busy}
              onClick={() => act("applied")}
              title="Mark as applied — logs to applications.md"
              className={`${btn} bg-zinc-100 text-zinc-600 hover:bg-emerald-100 hover:text-emerald-800`}
            >
              ✓
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => act("skip")}
            title="Not interested — removes from queue, won't be re-discovered"
            className={`${btn} bg-zinc-100 text-zinc-600 hover:bg-red-100 hover:text-red-700`}
          >
            ✕
          </button>
        </div>
      </div>
    </article>
  );
}
