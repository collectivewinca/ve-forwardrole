"use client";

import { useState } from "react";

export default function ShareCard({
  slug,
  password,
}: {
  slug: string;
  password: string;
}) {
  const [copied, setCopied] = useState<string>("");
  const url = `https://${slug}.here.now/`;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <section className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-amber-800">
          Your shareable shortlist
        </p>
        <span className="text-xs text-zinc-500">refreshed daily 0700 UTC</span>
      </div>
      <p className="mb-3 text-sm text-zinc-700">
        The polished view of your queue + tailored applications. Share this
        URL + password with mentors, hiring managers, or save it for yourself.
      </p>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs">
            {url}
          </code>
          <button
            onClick={() => copy(url, "url")}
            className="rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
          >
            {copied === "url" ? "✓ copied" : "Copy URL"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener"
            className="rounded-md border border-amber-700 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
          >
            Open ↗
          </a>
        </div>
        {password && (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs">
              password: {password}
            </code>
            <button
              onClick={() => copy(password, "pw")}
              className="rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800"
            >
              {copied === "pw" ? "✓ copied" : "Copy password"}
            </button>
            <button
              onClick={() => copy(`${url}\nPassword: ${password}`, "both")}
              className="rounded-md border border-amber-700 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              {copied === "both" ? "✓ copied" : "Copy both"}
            </button>
          </div>
        )}
        {!password && (
          <p className="text-xs italic text-amber-800">
            No password set yet — anyone with the URL can view. Set one in
            <code className="ml-1 rounded bg-amber-100 px-1 py-0.5 font-mono">
              search.yaml
            </code>{" "}
            under <code className="font-mono">publish.password</code>.
          </p>
        )}
      </div>
    </section>
  );
}
