import { NextRequest, NextResponse } from "next/server";
import { addExternalResult, readProfile, type ExternalResult } from "@/lib/profile";
import { currentUser } from "@/lib/pb";

export async function POST(
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

  const body = await req.json();
  const url = String(body.url || "").trim();
  const title = String(body.title || "").trim();
  const company = String(body.company || "").trim();
  if (!url || !title || !company) {
    return new NextResponse("url, title and company are required", { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return new NextResponse("url must start with http(s)://", { status: 400 });
  }

  const entry: ExternalResult = {
    url,
    title,
    company,
    source: String(body.source || "Manual").trim(),
    location: body.location ? String(body.location).trim() : undefined,
    note: body.note ? String(body.note).trim() : undefined,
  };
  addExternalResult(profile, entry);
  return NextResponse.json({ ok: true, entry });
}
