import { ArrowLeft } from "lucide-react";
import { getPublicProfile } from "@/src/lib/friends/actions";
import { Avatar } from "../../avatar";
import { UProfileAction } from "./u-action";

export default async function UserPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getPublicProfile(username);

  if (!profile) {
    return (
      <main className="container">
        <a href="/" className="pl__back">
          <ArrowLeft size={15} />
          Home
        </a>
        <p className="muted" style={{ marginTop: "2rem" }}>
          No one goes by <strong>@{username}</strong>.
        </p>
      </main>
    );
  }

  return (
    <main className="container">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Home
      </a>
      <div className="u">
        <div className="u__head">
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={80} />
          <div>
            <h1 className="u__name">{profile.displayName}</h1>
            {profile.username && <div className="u__handle">@{profile.username}</div>}
          </div>
        </div>
        <UProfileAction profile={profile} />
      </div>
    </main>
  );
}
