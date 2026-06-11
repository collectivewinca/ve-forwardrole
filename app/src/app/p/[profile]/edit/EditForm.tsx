"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function EditForm({
  profile,
  initialProfileMd,
  initialSearchYaml,
  initialCompaniesYaml,
}: {
  profile: string;
  initialProfileMd: string;
  initialSearchYaml: string;
  initialCompaniesYaml: string;
}) {
  const [profileMd, setProfileMd] = useState(initialProfileMd);
  const [searchYaml, setSearchYaml] = useState(initialSearchYaml);
  const [companiesYaml, setCompaniesYaml] = useState(
    initialCompaniesYaml || "# Companies whose job boards are polled every run.\ncompanies:\n  # - Stripe\n  # - Datadog\n",
  );
  const [status, setStatus] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function save() {
    setStatus("Saving…");
    const res = await fetch(`/work/api/profile/${profile}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileMd, searchYaml, companiesYaml }),
    });
    if (!res.ok) {
      const text = await res.text();
      setStatus(`✗ ${res.status}: ${text}`);
      return;
    }
    setStatus("✓ Saved");
    startTransition(() => router.refresh());
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/p/${profile}` as never} className="text-xs text-zinc-500 hover:text-orange-900">
        ← back to {profile}
      </Link>
      <h1 className="mt-3 font-serif text-3xl tracking-tight">Edit {profile}</h1>
      <p className="text-sm text-zinc-500">Writes directly to profiles/{profile}/. Cron picks up the change on the next 0700 UTC run.</p>

      <section className="mt-8">
        <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-zinc-500">
          profile.md (parsed CV)
        </label>
        <textarea
          value={profileMd}
          onChange={(e) => setProfileMd(e.target.value)}
          className="h-96 w-full rounded-md border border-zinc-200 bg-white p-4 font-mono text-sm leading-relaxed focus:border-orange-900 focus:outline-none"
        />
      </section>

      <section className="mt-8">
        <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-zinc-500">
          search.yaml (job search criteria + enrichment toggle)
        </label>
        <textarea
          value={searchYaml}
          onChange={(e) => setSearchYaml(e.target.value)}
          className="h-72 w-full rounded-md border border-zinc-200 bg-white p-4 font-mono text-sm leading-relaxed focus:border-orange-900 focus:outline-none"
        />
      </section>

      <section className="mt-8">
        <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-zinc-500">
          companies.yaml (ATS watchlist — every listed company&apos;s job board is polled twice daily)
        </label>
        <textarea
          value={companiesYaml}
          onChange={(e) => setCompaniesYaml(e.target.value)}
          className="h-44 w-full rounded-md border border-zinc-200 bg-white p-4 font-mono text-sm leading-relaxed focus:border-orange-900 focus:outline-none"
        />
      </section>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-md bg-orange-900 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-950 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <span className="text-sm text-zinc-600">{status}</span>
      </div>
    </main>
  );
}
