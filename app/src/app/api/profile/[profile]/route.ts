import { NextRequest, NextResponse } from "next/server";
import { writeProfileMd, writeSearchYaml, writeCompaniesYaml, readProfile } from "@/lib/profile";
import { currentUser } from "@/lib/pb";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ profile: string }> },
) {
  const { profile } = await ctx.params;
  const user = await currentUser();
  if (!user) return new NextResponse("unauthenticated", { status: 401 });
  if (user.profile !== profile) return new NextResponse("forbidden", { status: 403 });
  if (!readProfile(profile)) {
    return new NextResponse("profile not found", { status: 404 });
  }

  // Size caps — these files are read live by the dashboard and the pipeline, so a
  // runaway paste shouldn't be able to bloat them. profile.md is prose; search.yaml
  // is a small config.
  const MAX_PROFILE = 100_000; // ~100 KB
  const MAX_SEARCH = 20_000; //  ~20 KB

  let payload: { profileMd?: unknown; searchYaml?: unknown; companiesYaml?: unknown };
  try {
    payload = await req.json();
  } catch {
    return new NextResponse("invalid JSON body", { status: 400 });
  }
  const { profileMd, searchYaml, companiesYaml } = payload;

  // At least one field must be present, and any present field must be a non-empty
  // string within its size cap. Reject rather than silently writing junk.
  // (companiesYaml MAY be empty — clearing the watchlist is a valid edit.)
  const hasProfile = profileMd !== undefined;
  const hasSearch = searchYaml !== undefined;
  const hasCompanies = companiesYaml !== undefined;
  if (!hasProfile && !hasSearch && !hasCompanies) {
    return new NextResponse("no fields to update", { status: 400 });
  }
  if (hasCompanies) {
    if (typeof companiesYaml !== "string") return new NextResponse("companiesYaml must be a string", { status: 400 });
    if (companiesYaml.length > MAX_SEARCH) return new NextResponse(`companiesYaml exceeds ${MAX_SEARCH} char limit`, { status: 413 });
  }
  if (hasProfile) {
    if (typeof profileMd !== "string") return new NextResponse("profileMd must be a string", { status: 400 });
    if (profileMd.trim().length === 0) return new NextResponse("profileMd cannot be empty", { status: 400 });
    if (profileMd.length > MAX_PROFILE) return new NextResponse(`profileMd exceeds ${MAX_PROFILE} char limit`, { status: 413 });
  }
  if (hasSearch) {
    if (typeof searchYaml !== "string") return new NextResponse("searchYaml must be a string", { status: 400 });
    if (searchYaml.trim().length === 0) return new NextResponse("searchYaml cannot be empty", { status: 400 });
    if (searchYaml.length > MAX_SEARCH) return new NextResponse(`searchYaml exceeds ${MAX_SEARCH} char limit`, { status: 413 });
  }

  if (hasProfile) writeProfileMd(profile, profileMd as string);
  if (hasSearch) writeSearchYaml(profile, searchYaml as string);
  if (hasCompanies) writeCompaniesYaml(profile, companiesYaml as string);
  return NextResponse.json({ ok: true });
}
