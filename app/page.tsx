import { ListMusic } from "lucide-react";
import { createClient } from "@/src/lib/supabase/server";
import { isYouTubeConnected } from "@/src/lib/supabase/youtube-auth";
import { getMyProfile } from "@/src/lib/profile/actions";
import { safeNext } from "@/src/lib/safe-next";
import { Avatar } from "./avatar";
import { Reveal } from "./reveal";
import { SignInButton } from "./sign-in-button";
import { ConnectYouTubeButton } from "./connect-youtube-button";
import { CreateJamButton } from "./create-jam-button";
import { JoinJamForm } from "./join-jam-form";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; full?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const youtubeConnected = await isYouTubeConnected();
  const profile = user ? await getMyProfile() : null;

  const sp = await searchParams;
  // Where an invited-but-signed-out visitor should land after signing in.
  const nextPath = safeNext(sp.next);
  const returnTo = nextPath === "/" ? undefined : nextPath;
  // Set when someone was turned away because the app is at its signup cap.
  const isFull = sp.full === "1";

  const displayName = profile?.displayName ?? "";

  return (
    <>
      {user && (
        <header className="topbar">
          <div className="account">
            <a href="/profile" className="account__me">
              <Avatar name={displayName} url={profile?.avatarUrl} size={30} />
              <span className="account__name">{displayName}</span>
            </a>
            <a href="/friends" className="btn btn--sm">
              Friends
            </a>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn--sm">
                Sign out
              </button>
            </form>
          </div>
        </header>
      )}

      <main className="container hero">
        <Reveal>
          <h1 className="display">june</h1>
        </Reveal>
        <Reveal delay={0.08}>
          <p className="lead">Play the same song, at the same second, with your friends.</p>
        </Reveal>

        {!user ? (
          <Reveal delay={0.16}>
            <div className="stack" style={{ marginTop: "2.5rem" }}>
              {isFull && (
                <p className="muted" style={{ maxWidth: "34ch", marginBottom: "0.25rem" }}>
                  june is full right now. It’s capped while it’s new. Check back soon.
                </p>
              )}
              <SignInButton next={returnTo} />
              <span className="faint" style={{ fontSize: "0.85rem" }}>
                {returnTo
                  ? "Sign in to join the jam you were invited to."
                  : "Sign in to start a room. Friends join with a code."}
              </span>
            </div>
          </Reveal>
        ) : (
          <Reveal delay={0.16}>
            <div className="lobby">
              <CreateJamButton displayName={displayName} />
              <div className="divider">or join a room</div>
              <JoinJamForm />
            </div>

            <div className="yt-status">
              {youtubeConnected ? (
                <span className="yt-badge">
                  <ListMusic size={15} />
                  YouTube connected
                </span>
              ) : (
                <>
                  <span className="muted">Connect YouTube to browse your playlists</span>
                  <ConnectYouTubeButton />
                </>
              )}
            </div>
          </Reveal>
        )}
      </main>
    </>
  );
}
