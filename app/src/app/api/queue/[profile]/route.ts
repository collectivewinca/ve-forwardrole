import { NextRequest, NextResponse } from "next/server";
import {
  readProfile,
  recordDecision,
  skipQueueEntry,
  appendApplication,
  readDecisions,
} from "@/lib/profile";
import { currentUser } from "@/lib/pb";

// POST { url, action: "skip" | "applied" | "star" | "unstar", title?, company? }
// Dashboard role actions. "skip" also moves the queue.md line to ## Processed
// (same shape triage writes, so dedup keeps it from being re-discovered);
// "applied" also appends an applications.md entry.
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("unauthenticated", { status: 401 });
  if (user.profile !== profile) return new NextResponse("forbidden", { status: 403 });
  if (!readProfile(profile)) return new NextResponse("profile not found", { status: 404 });

  let body: { url?: unknown; action?: unknown; title?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("invalid JSON body", { status: 400 });
  }
  const url = String(body.url || "").trim();
  const action = String(body.action || "");
  if (!/^https?:\/\//.test(url)) return new NextResponse("valid url required", { status: 400 });

  const now = new Date().toISOString();
  if (action === "skip") {
    skipQueueEntry(profile, url, "dismissed from dashboard");
    recordDecision(profile, url, { status: "skipped", at: now });
  } else if (action === "applied") {
    appendApplication(profile, url, String(body.title || "Role"), String(body.company || "Company"));
    recordDecision(profile, url, { status: "applied", at: now });
  } else if (action === "star") {
    recordDecision(profile, url, { status: "starred", at: now });
  } else if (action === "unstar") {
    const cur = readDecisions(profile)[url];
    if (cur?.status === "starred") recordDecision(profile, url, null);
  } else {
    return new NextResponse("unknown action", { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
