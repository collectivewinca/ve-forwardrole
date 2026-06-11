import PocketBase from "pocketbase";
import { cookies } from "next/headers";

const PB_URL = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
const COOKIE_NAME = "pb_auth";

export function pbClient(): PocketBase {
  return new PocketBase(PB_URL);
}

export async function pbFromCookies(): Promise<PocketBase> {
  const pb = pbClient();
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME)?.value;
  if (cookie) {
    pb.authStore.loadFromCookie(`${COOKIE_NAME}=${cookie}`);
  }
  return pb;
}

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  profile: string;
}

export async function currentUser(): Promise<AuthedUser | null> {
  const pb = await pbFromCookies();
  if (!pb.authStore.isValid || !pb.authStore.record) return null;
  const r = pb.authStore.record as unknown as AuthedUser;
  return { id: r.id, email: r.email, name: r.name, profile: r.profile };
}

export async function setAuthCookie(pb: PocketBase): Promise<void> {
  const exported = pb.authStore.exportToCookie({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 14 });
  // exported is "name=value; Path=/; ..." — extract value
  const valueMatch = exported.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!valueMatch) return;
  const jar = await cookies();
  jar.set({
    name: COOKIE_NAME,
    value: valueMatch[1],
    httpOnly: true,
    sameSite: "lax",
    secure: false, // exe.dev terminates HTTPS at the edge; app sees http://
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearAuthCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
