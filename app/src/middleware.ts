import { NextResponse, NextRequest } from "next/server";

const COOKIE_NAME = "pb_auth";
const PUBLIC = new Set<string>(["/login"]);

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/work/, "") || "/";

  // Allow public paths
  if (PUBLIC.has(path)) return NextResponse.next();

  // Allow static assets, login, and the share preview tokens
  if (path.startsWith("/_next") || path.startsWith("/api/auth")) return NextResponse.next();

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) {
    const loginUrl = new URL("/work/login", req.url);
    loginUrl.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon|.*\\..*).*)"],
};
