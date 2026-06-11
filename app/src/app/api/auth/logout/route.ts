import { NextRequest, NextResponse } from "next/server";

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `https://${host}`;
}

function handle(req: NextRequest) {
  const res = NextResponse.redirect(`${publicOrigin(req)}/work/login`, { status: 303 });
  res.cookies.delete("pb_auth");
  return res;
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
