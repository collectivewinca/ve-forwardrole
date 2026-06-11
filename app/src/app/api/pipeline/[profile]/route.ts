import { NextRequest, NextResponse } from "next/server";
import { readProfile, pipelineStatus, startPipeline } from "@/lib/profile";
import { currentUser } from "@/lib/pb";

// GET  → { lastSuccess, running, logTail }  (pipeline shared across profiles,
//         but still scoped behind the per-profile auth gate)
// POST { step: "refresh" | "discover" } → kick a run, detached from the request.
//   refresh  = enrich-exa + jd-fit + render (no new discovery, no Apify spend)
//   discover = the full twice-daily chain (pi/run-pipeline.sh)

async function gate(profile: string): Promise<NextResponse | null> {
  const user = await currentUser();
  if (!user) return new NextResponse("unauthenticated", { status: 401 });
  if (user.profile !== profile) return new NextResponse("forbidden", { status: 403 });
  if (!readProfile(profile)) return new NextResponse("profile not found", { status: 404 });
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const denied = await gate(profile);
  if (denied) return denied;
  return NextResponse.json(pipelineStatus());
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const denied = await gate(profile);
  if (denied) return denied;

  let body: { step?: unknown };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("invalid JSON body", { status: 400 });
  }
  const step = body.step === "discover" ? "discover" : body.step === "refresh" ? "refresh" : null;
  if (!step) return new NextResponse("step must be refresh or discover", { status: 400 });

  const r = startPipeline(step);
  if (!r.ok) return new NextResponse(r.error || "failed to start", { status: 409 });
  return NextResponse.json({ ok: true, step });
}
