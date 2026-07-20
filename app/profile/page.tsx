import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/src/lib/supabase/server";
import { getMyProfile } from "@/src/lib/profile/actions";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/?next=${encodeURIComponent("/profile")}`);

  const profile = await getMyProfile();

  return (
    <main className="container">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <h1 className="pl__title" style={{ margin: "1rem 0 0.5rem" }}>
        Profile
      </h1>
      <ProfileForm initial={profile} />
    </main>
  );
}
