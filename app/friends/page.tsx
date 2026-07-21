import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/src/lib/supabase/server";
import { getFriendsOverview } from "@/src/lib/friends/actions";
import { FriendsClient } from "./friends-client";

export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/?next=${encodeURIComponent("/friends")}`);

  const { incoming, friends } = await getFriendsOverview();

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <h1 className="pl__title" style={{ margin: "1rem 0 0" }}>
        Friends
      </h1>
      <FriendsClient incoming={incoming} friends={friends} />
    </main>
  );
}
