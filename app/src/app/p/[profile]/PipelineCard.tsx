"use client";

import { useEffect, useState } from "react";

interface Status {
  lastSuccess: number | null;
  running: "discover" | "refresh" | null;
  logTail: string[];
}

function ago(unix: number): string {
  const h = (Date.now() / 1000 - unix) / 3600;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${h.toFixed(1)} h ago`;
  return `${(h / 24).toFixed(1)} days ago`;
}

export function PipelineCard({ profile, initial }: { profile: string; initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll only while a run is active — idle dashboards make zero extra requests.
  useEffect(() => {
    if (!status.running) return;
    const t = setInterval(async () => {
      const res = await fetch(`/work/api/pipeline/${profile}`).catch(() => null);
      if (res?.ok) setStatus(await res.json());
    }, 5000);
    return () => clearInterval(t);
  }, [status.running, profile]);

  async function run(step: "refresh" | "discover") {
    setError(null);
    const res = await fetch(`/work/api/pipeline/${profile}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step }),
    }).catch(() => null);
    if (!res) { setError("request failed"); return; }
    if (!res.ok) { setError(await res.text()); return; }
    setStatus((s) => ({ ...s, running: step }));
    setShowLog(true);
  }

  const stale = status.lastSuccess !== null && Date.now() / 1000 - status.lastSuccess > 14 * 3600;
  const btn = "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";

  return (
    <section className="mb-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Pipeline</p>
        {status.running ? (
          <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-900">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-700" />
            {status.running === "discover" ? "full discovery running…" : "refreshing data…"}
          </span>
        ) : (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stale ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"}`}>
            {status.lastSuccess ? `last full run ${ago(status.lastSuccess)}` : "no run recorded yet"}
          </span>
        )}
        <span className="text-[11px] text-zinc-500">auto-runs 07:00 & 19:00 UTC</span>
        <div className="ml-auto flex gap-2">
          <button
            disabled={!!status.running}
            onClick={() => run("refresh")}
            title="Re-run warm paths, fit scoring and the shareable page — no new role discovery"
            className={`${btn} border border-orange-900 text-orange-900 hover:bg-orange-900 hover:text-white`}
          >
            Refresh data
          </button>
          <button
            disabled={!!status.running}
            onClick={() => run("discover")}
            title="Run the full chain now: discover new roles, triage, enrich, publish"
            className={`${btn} bg-orange-900 text-white hover:bg-orange-950`}
          >
            Find new roles now
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {status.logTail.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowLog(!showLog)} className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800">
            {showLog ? "hide log ▴" : "show log ▾"}
          </button>
          {showLog && (
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-zinc-200 bg-white p-2 text-[10.5px] leading-relaxed text-zinc-600">
              {status.logTail.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
