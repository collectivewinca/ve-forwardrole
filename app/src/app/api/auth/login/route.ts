import { NextRequest, NextResponse } from "next/server";
import { pbClient } from "@/lib/pb";

const COOKIE_NAME = "pb_auth";

function publicOrigin(req: NextRequest): string {
  // exe.dev edge always serves TLS publicly. Force https regardless of forwarded proto.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `https://${host}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const next = String(form.get("next") || "/work");

  const origin = publicOrigin(req);

  if (!email || !password) {
    return NextResponse.redirect(`${origin}/work/login?err=missing`, { status: 303 });
  }

  const pb = pbClient();
  try {
    await pb.collection("users").authWithPassword(email, password);
  } catch {
    return NextResponse.redirect(`${origin}/work/login?err=invalid`, { status: 303 });
  }

  const profile = (pb.authStore.record as { profile?: string } | null)?.profile;
  const dest = profile ? `${origin}/work/p/${profile}` : `${origin}${next}`;

  // Build response with auth cookie
  const exported = pb.authStore.exportToCookie({
    httpOnly: true,
    secure: false, // nginx terminates TLS — app talks http internally
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  });
  const valueMatch = exported.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));

  const res = NextResponse.redirect(dest, { status: 303 });
  if (valueMatch) {
    res.cookies.set({
      name: COOKIE_NAME,
      value: valueMatch[1],
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  }
  return res;
}
