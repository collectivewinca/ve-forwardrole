import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readProfile, pipelineStatus } from "@/lib/profile";
import { currentUser } from "@/lib/pb";
import ShareCard from "./ShareCard";
import { DashboardTabs } from "./DashboardTabs";
import { PipelineCard } from "./PipelineCard";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.profile !== profile) redirect(`/p/${user.profile}`);

  const data = readProfile(profile);
  // A PB account with no parsed profile yet = brand-new user → wizard.
  if (!data || !data.profileMd) redirect(`/p/${profile}/onboard`);
  if (!data) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-orange-900">
          ve-work · {user.name}
        </p>
        <a
          href="/api/auth/logout"
          className="text-xs text-zinc-500 hover:text-orange-900"
        >
          Sign out
        </a>
      </div>
      <h1 className="mt-3 font-serif text-3xl capitalize tracking-tight">
        {data.name}
      </h1>
      <p className="text-sm text-zinc-500">
        {data.queueEntries.length} queued role(s) · {data.outputFiles.length} tailored doc(s)
      </p>

      <div className="mt-6 mb-10 flex gap-2">
        <Link
          href={`/p/${data.name}/edit` as never}
          className="rounded-md bg-orange-900 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-950"
        >
          Edit profile.md / search.yaml
        </Link>
        <Link
          href={`/p/${data.name}/onboard` as never}
          className="rounded-md border border-orange-900 px-4 py-2 text-sm font-semibold text-orange-900 hover:bg-orange-900 hover:text-white"
        >
          Preferences
        </Link>
      </div>

      <PipelineCard profile={data.name} initial={pipelineStatus()} />

      {data.publish && (
        <ShareCard slug={data.publish.slug} password={data.publish.password} />
      )}
      {!data.publish && (
        <section className="mb-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
            Shareable shortlist
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            No here.now slug claimed yet. The next cron run (or a manual
            <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs">
              npm run render
            </code>
            ) will create one.
          </p>
        </section>
      )}

      {(() => {
        const active = data.queueEntries.filter((e) => data.listingStatus[e.url] !== "EXPIRED");
        const expired = data.queueEntries.filter((e) => data.listingStatus[e.url] === "EXPIRED");
        return (
          <DashboardTabs
            profile={data.name}
            active={active}
            expired={expired}
            external={data.external}
            alumniByCompany={data.alumniByCompany}
            companies={data.companies}
            fitByUrl={data.fitByUrl}
            searchHistory={data.searchHistory}
            school={data.school}
            schoolLabel={data.schoolLabel}
            listingStatus={data.listingStatus}
            tailoredByCompany={data.tailoredByCompany}
            decisions={data.decisions}
          />
        );
      })()}

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
          Tailored output
        </h2>
        <div className="grid gap-2">
          {data.outputFiles.map((f) => (
            <div
              key={f}
              className="rounded-md border border-zinc-200 bg-white px-4 py-2 font-mono text-xs"
            >
              {f}
            </div>
          ))}
          {data.outputFiles.length === 0 && (
            <p className="text-sm text-zinc-500">No tailored docs yet.</p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">
          Applications log
        </h2>
        <pre className="overflow-auto rounded-md border border-zinc-200 bg-white p-4 text-xs leading-relaxed">
          {data.applicationsMd || "(empty)"}
        </pre>
      </section>
    </main>
  );
}
