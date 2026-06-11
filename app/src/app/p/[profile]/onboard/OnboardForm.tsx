"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  linkedinUrl: string;
  availability: string;
  minComp: string;
  currency: string;
  hardNos: string;
  stage: string;
  sponsorship: string;
  tone: string;
  telegramChat: string;
}

const inputCls =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-orange-900 focus:outline-none";
const labelCls = "mb-1.5 block text-xs font-bold uppercase tracking-widest text-zinc-500";

export default function OnboardForm({
  profile,
  isNew,
  initial,
}: {
  profile: string;
  isNew: boolean;
  initial: Initial;
}) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl);
  const [keywords, setKeywords] = useState("");
  const [locations, setLocations] = useState("");
  const [availability, setAvailability] = useState(initial.availability);
  const [minComp, setMinComp] = useState(initial.minComp);
  const [currency, setCurrency] = useState(initial.currency);
  const [hardNos, setHardNos] = useState(initial.hardNos);
  const [stage, setStage] = useState(initial.stage);
  const [sponsorship, setSponsorship] = useState(initial.sponsorship);
  const [tone, setTone] = useState(initial.tone);
  const [telegramChat, setTelegramChat] = useState(initial.telegramChat);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit() {
    if (busy) return;
    if (isNew && !pdf) { setStatus("✗ Upload your LinkedIn PDF first."); return; }
    if (isNew && (!keywords.trim() || !locations.trim())) {
      setStatus("✗ Keywords and locations are required.");
      return;
    }
    setBusy(true);
    setStatus(isNew ? "Setting up your profile — parsing your LinkedIn PDF…" : "Saving preferences…");
    const fd = new FormData();
    if (pdf) fd.set("pdf", pdf);
    fd.set("linkedinUrl", linkedinUrl);
    fd.set("keywords", keywords);
    fd.set("locations", locations);
    fd.set("availability", availability);
    fd.set("minComp", minComp);
    fd.set("currency", currency);
    fd.set("hardNos", hardNos);
    fd.set("stage", stage);
    fd.set("sponsorship", sponsorship);
    fd.set("tone", tone);
    fd.set("telegramChat", telegramChat);
    const res = await fetch(`/work/api/onboard/${profile}`, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setStatus(`✗ ${res ? await res.text() : "request failed"}`);
      return;
    }
    const d = await res.json();
    if (d.mode === "onboarding") {
      setStatus("✓ Profile setup is running (a few minutes). Your dashboard will fill in as it completes.");
      setTimeout(() => router.push(`/p/${profile}` as never), 2500);
    } else {
      setStatus("✓ Preferences saved. They shape the next discovery run.");
      setTimeout(() => router.push(`/p/${profile}` as never), 1500);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      {!isNew && (
        <Link href={`/p/${profile}` as never} className="text-xs text-zinc-500 hover:text-orange-900">
          ← back to {profile}
        </Link>
      )}
      <p className="mt-3 text-xs font-bold uppercase tracking-widest text-orange-900">ve-work</p>
      <h1 className="mt-1 font-serif text-3xl tracking-tight">
        {isNew ? "Let's set up your job search" : "Your preferences"}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        {isNew
          ? "Five questions. The robot does the rest — twice a day, every day."
          : "These quietly shape what the robot looks for. Change them any time."}
      </p>

      {isNew && (
        <section className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
          <label className={labelCls}>1 · Your LinkedIn</label>
          <p className="mb-3 text-xs text-zinc-500">
            On LinkedIn: your profile → <b>More</b> → <b>Save to PDF</b>. Drop the file here.
          </p>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setPdf(e.target.files?.[0] || null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-orange-900 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
          />
          <input
            type="url"
            placeholder="https://linkedin.com/in/you  (optional — helps find warm intros)"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            className={`${inputCls} mt-3`}
          />
        </section>
      )}

      {isNew && (
        <section className="mt-6">
          <label className={labelCls}>2 · Roles you&apos;d actually take</label>
          <input
            placeholder='e.g. head of product, VP engineering, chief of staff (comma-separated)'
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className={inputCls}
          />
          <label className={`${labelCls} mt-4`}>Locations</label>
          <input
            placeholder='e.g. New York, Remote'
            value={locations}
            onChange={(e) => setLocations(e.target.value)}
            className={inputCls}
          />
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>{isNew ? "3 · " : ""}When could you start?</label>
          <select value={availability} onChange={(e) => setAvailability(e.target.value)} className={inputCls}>
            <option>Immediately</option>
            <option>2 weeks</option>
            <option>1 month</option>
            <option>2-3 months</option>
            <option>Just exploring</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Company stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
            <option value="any">No preference</option>
            <option value="startup">Startup (seed–B)</option>
            <option value="scaleup">Scale-up (C+)</option>
            <option value="enterprise">Enterprise / public</option>
          </select>
        </div>
      </section>

      <section className="mt-6">
        <label className={labelCls}>{isNew ? "4 · " : ""}What offer would you consider?</label>
        <p className="mb-2 text-xs text-zinc-500">
          The minimum total compensation you&apos;d seriously look at. We use this as a quality filter — lowball
          roles never reach your shortlist.
        </p>
        <div className="flex gap-2">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} w-28`}>
            <option>USD</option>
            <option>CAD</option>
            <option>EUR</option>
            <option>GBP</option>
          </select>
          <input
            inputMode="numeric"
            placeholder="e.g. 200000"
            value={minComp}
            onChange={(e) => setMinComp(e.target.value)}
            className={inputCls}
          />
        </div>
      </section>

      <section className="mt-6">
        <label className={labelCls}>{isNew ? "5 · " : ""}Hard NOs</label>
        <input
          placeholder='e.g. equity-only, 100% commission, crypto, specific companies (comma-separated)'
          value={hardNos}
          onChange={(e) => setHardNos(e.target.value)}
          className={inputCls}
        />
      </section>

      <section className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Need visa sponsorship?</label>
          <select value={sponsorship} onChange={(e) => setSponsorship(e.target.value)} className={inputCls}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Outreach tone</label>
          <select value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls}>
            <option value="warm">Warm & casual</option>
            <option value="direct">Direct & brief</option>
            <option value="formal">Formal</option>
          </select>
        </div>
      </section>

      <section className="mt-6">
        <label className={labelCls}>Telegram chat ID (optional — morning digest)</label>
        <input
          placeholder="Message your bot once, then check getUpdates for the ID"
          value={telegramChat}
          onChange={(e) => setTelegramChat(e.target.value)}
          className={inputCls}
        />
      </section>

      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-orange-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-950 disabled:opacity-50"
        >
          {busy ? "Working…" : isNew ? "Start my job search" : "Save preferences"}
        </button>
        <span className="text-sm text-zinc-600">{status}</span>
      </div>
    </main>
  );
}
