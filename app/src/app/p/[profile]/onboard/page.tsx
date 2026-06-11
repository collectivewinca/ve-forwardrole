import { redirect } from "next/navigation";
import { readProfile, readPrefs } from "@/lib/profile";
import { currentUser } from "@/lib/pb";
import OnboardForm from "./OnboardForm";

export const dynamic = "force-dynamic";

export default async function OnboardPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.profile !== profile) redirect(`/p/${user.profile}/onboard`);

  // No 404 for a missing profile dir — that's the first-time case.
  const data = readProfile(profile);
  const isNew = !data || !data.profileMd;
  const prefs = readPrefs(profile);

  return (
    <OnboardForm
      profile={profile}
      isNew={isNew}
      initial={{
        linkedinUrl: prefs.linkedin_url || "",
        availability: prefs.availability || "1 month",
        minComp: prefs.comp?.stated ? String(prefs.comp.stated) : "",
        currency: prefs.comp?.currency || "USD",
        hardNos: (prefs.hard_nos || []).join(", "),
        stage: prefs.stage || "any",
        sponsorship: prefs.sponsorship_needed ? "yes" : "no",
        tone: prefs.outreach_tone || "warm",
        telegramChat: prefs.telegram_chat || "",
      }}
    />
  );
}
