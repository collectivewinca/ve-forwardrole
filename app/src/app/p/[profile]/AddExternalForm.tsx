"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddExternalForm({ profile }: { profile: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    url: "",
    title: "",
    company: "",
    source: "Company careers",
    location: "",
    note: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch(`/work/api/external/${profile}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setForm({ url: "", title: "", company: "", source: "Company careers", location: "", note: "" });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-orange-900 px-4 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-900 hover:text-white"
      >
        + Add a role from another source
      </button>
    );
  }

  const input = "w-full rounded-md border border-zinc-300 px-3 py-2 text-sm";
  return (
    <form onSubmit={submit} className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <input className={input} placeholder="Job URL *" value={form.url} onChange={set("url")} required />
        <input className={input} placeholder="Source (e.g. Company careers, Indeed)" value={form.source} onChange={set("source")} />
        <input className={input} placeholder="Role title *" value={form.title} onChange={set("title")} required />
        <input className={input} placeholder="Company *" value={form.company} onChange={set("company")} required />
        <input className={input} placeholder="Location (optional)" value={form.location} onChange={set("location")} />
        <input className={input} placeholder="Note (optional)" value={form.note} onChange={set("note")} />
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-950 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save role"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800">
          Cancel
        </button>
      </div>
    </form>
  );
}
