import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { readProfile, writePrefs, startOnboard, type Prefs } from "@/lib/profile";
import { currentUser } from "@/lib/pb";

const ROOT = process.env.VE_WORK_ROOT || `${process.env.HOME}/ve-work`;
// Search-floor uplift over the candidate's stated minimum. Discovered roles
// then carry negotiation headroom by construction. Deliberately server-side
// only — no UI surfaces it.
const COMP_UPLIFT = 0.125;

// POST multipart/form-data. Two modes:
//  - new profile (no profiles/<name>/ yet): requires a LinkedIn PDF +
//    keywords + locations; saves prefs, then launches pi/onboard.sh detached.
//  - existing profile: updates prefs.json only (preferences re-run).
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("unauthenticated", { status: 401 });
  if (user.profile !== profile) return new NextResponse("forbidden", { status: 403 });
  // NOTE: no readProfile() 404 gate here — a brand-new user has a PB account
  // but no profile directory yet; that's exactly who this endpoint serves.

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("expected multipart form data", { status: 400 });
  }
  const str = (k: string) => String(form.get(k) || "").trim();

  const keywords = str("keywords");
  const locations = str("locations");
  const statedComp = parseInt(str("minComp").replace(/[^0-9]/g, ""), 10) || 0;
  const currency = str("currency") || "USD";

  const prefs: Prefs = {
    generated_at: new Date().toISOString().slice(0, 10),
    linkedin_url: str("linkedinUrl") || undefined,
    availability: str("availability") || undefined,
    comp: statedComp
      ? { stated: statedComp, currency, floor: Math.round((statedComp * (1 + COMP_UPLIFT)) / 5000) * 5000, uplift: COMP_UPLIFT }
      : undefined,
    hard_nos: str("hardNos") ? str("hardNos").split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    stage: str("stage") || undefined,
    sponsorship_needed: str("sponsorship") === "yes",
    outreach_tone: str("tone") || undefined,
    telegram_chat: str("telegramChat") || undefined,
  };

  const isNew = !readProfile(profile) || !readProfile(profile)?.profileMd;
  if (!isNew) {
    writePrefs(profile, prefs);
    return NextResponse.json({ ok: true, mode: "updated" });
  }

  // New profile: PDF + keywords + locations are required.
  if (!keywords || !locations) {
    return new NextResponse("keywords and locations are required", { status: 400 });
  }
  const pdf = form.get("pdf");
  if (!(pdf instanceof File) || pdf.size === 0) {
    return new NextResponse("LinkedIn PDF is required for first-time setup", { status: 400 });
  }
  if (pdf.size > 15_000_000) return new NextResponse("PDF too large (15 MB max)", { status: 413 });

  const tmpPdf = path.join("/tmp", `onboard-${profile}.pdf`);
  fs.writeFileSync(tmpPdf, Buffer.from(await pdf.arrayBuffer()));

  // onboard.sh refuses to overwrite an existing dir; a half-created dir (PB
  // user made, dir seeded but empty) would block it — clear that case first.
  const dir = path.join(ROOT, "profiles", profile);
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, "profile.md"))) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const r = startOnboard(profile, tmpPdf, keywords, locations, prefs.telegram_chat);
  if (!r.ok) return new NextResponse(r.error || "failed to start onboarding", { status: 409 });

  // Prefs dir is created by onboard.sh asynchronously — write prefs after a
  // short defer so the directory exists. mkdir-recursive in writePrefs makes
  // this safe even if we win the race.
  writePrefs(profile, prefs);
  return NextResponse.json({ ok: true, mode: "onboarding" });
}
