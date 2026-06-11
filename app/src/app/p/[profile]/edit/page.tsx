import { notFound, redirect } from "next/navigation";
import { readProfile } from "@/lib/profile";
import { currentUser } from "@/lib/pb";
import EditForm from "./EditForm";

export const dynamic = "force-dynamic";

export default async function EditPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile } = await params;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.profile !== profile) redirect(`/p/${user.profile}`);
  const data = readProfile(profile);
  if (!data) notFound();
  return (
    <EditForm
      profile={profile}
      initialProfileMd={data.profileMd}
      initialSearchYaml={data.searchYaml}
      initialCompaniesYaml={data.companiesYaml}
    />
  );
}
