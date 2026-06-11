import { NextRequest, NextResponse } from "next/server";
import { readProfile, readPrefs } from "@/lib/profile";
import { currentUser } from "@/lib/pb";

// POST { name, title?, company, path?, via?, introAngle? }
// Drafts a short LinkedIn outreach message to a warm contact, in the
// candidate's voice, via the exe-dev LLM gateway (same path the triage step
// uses — link-local, no API key).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("unauthenticated", { status: 401 });
  if (user.profile !== profile) return new NextResponse("forbidden", { status: 403 });
  const data = readProfile(profile);
  if (!data) return new NextResponse("profile not found", { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("invalid JSON body", { status: 400 });
  }
  const person = String(body.name || "").trim();
  const company = String(body.company || "").trim();
  if (!person || !company) return new NextResponse("name and company required", { status: 400 });

  const tie =
    body.path === "ex-colleague"
      ? `You both worked at ${String(body.via || "the same company")} (different times are fine).`
      : body.via
        ? `You both attended ${String(body.via)}.`
        : "No confirmed tie — keep it role-based and specific.";

  const toneMap: Record<string, string> = {
    warm: "Warm and casual — like messaging a friendly acquaintance.",
    direct: "Direct and brief — busy-person energy, no pleasantries padding.",
    formal: "Polished and professional — respectful distance.",
  };
  const tone = toneMap[readPrefs(profile).outreach_tone || ""] || toneMap.warm;

  const prompt = `Draft a LinkedIn connection-request message (max 290 characters — LinkedIn's limit) from a job seeker to a warm contact. No subject line, no signature, no placeholder brackets. Sound like a person, not a template; one specific hook, one soft ask (a quick chat, not a referral demand). Tone: ${tone}

Sender's profile (excerpt — match their voice and seniority):
${data.profileMd.slice(0, 1500)}

Recipient: ${person}${body.title ? `, ${String(body.title)}` : ""} at ${company}.
Warm tie: ${tie}
${body.introAngle ? `Suggested angle: ${String(body.introAngle)}` : ""}

Output ONLY the message text.`;

  // ANTHROPIC_API_KEY → api.anthropic.com (anywhere); unset → exe.dev gateway.
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  const llmUrl = key
    ? "https://api.anthropic.com/v1/messages"
    : "http://169.254.169.254/gateway/llm/anthropic/v1/messages";
  const res = await fetch(llmUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...(key ? { "x-api-key": key } : {}) },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!res || !res.ok) {
    return new NextResponse(`gateway error${res ? ` (${res.status})` : ""}`, { status: 502 });
  }
  const d = (await res.json()) as { content?: { text?: string }[] };
  const draft = (d.content?.[0]?.text || "").trim();
  if (!draft) return new NextResponse("empty draft", { status: 502 });
  return NextResponse.json({ ok: true, draft });
}
