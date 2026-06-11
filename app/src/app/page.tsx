import { redirect } from "next/navigation";
import { currentUser } from "@/lib/pb";

export const dynamic = "force-dynamic";

export default async function Home() {
  const u = await currentUser();
  if (!u) redirect("/login");
  redirect(`/p/${u.profile}`);
}
