import { ListMusic, ArrowRight } from "lucide-react";
import { createClient } from "@/src/lib/supabase/server";
import { isYouTubeConnected } from "@/src/lib/supabase/youtube-auth";
import { safeNext } from "@/src/lib/safe-next";
import { SignInButton } from "./sign-in-button";
import { ConnectYouTubeButton } from "./connect-youtube-button";
import { CreateJamButton } from "./create-jam-button";
import { JoinJamForm } from "./join-jam-form";

function displayNameOf(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const meta = user.user_metadata ?? {};
  return (
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user.email ??
    "Guest"
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const youtubeConnected = await isYouTubeConnected();

  // Where an invited-but-signed-out visitor should land after signing in.
  const nextPath = safeNext((await searchParams).next);
  const returnTo = nextPath === "/" ? undefined : nextPath;

  const displayName = user ? displayNameOf(user) : "";

  return (
    <>
      {user && (
        <header className="topbar">
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {displayName.charAt(0).toUpperCase()}
            </span>
            <span className="account__name">{displayName}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn--sm">
                Sign out
              </button>
            </form>
          </div>
        </header>
      )}

      <main className="container hero rise">
        <h1 className="display">june</h1>
        <p className="lead">Play the same song, at the same second, with your friends.</p>

        {!user ? (
          <div className="stack" style={{ marginTop: "2.5rem" }}>
            <SignInButton next={returnTo} />
            <span className="faint" style={{ fontSize: "0.85rem" }}>
              {returnTo
                ? "Sign in to join the jam you were invited to."
                : "Sign in to start a room — your friends join with a code."}
            </span>
          </div>
        ) : (
          <>
            <div className="lobby">
              <CreateJamButton displayName={displayName} />
              <div className="divider">or join a room</div>
              <JoinJamForm />
            </div>

            <div className="yt-status">
              {youtubeConnected ? (
                <>
                  <span className="yt-badge">
                    <ListMusic size={15} />
                    YouTube connected
                  </span>
                  <span className="faint">·</span>
                  <a href="/playlists" className="muted">
                    Your playlists
                    <ArrowRight size={14} />
                  </a>
                </>
              ) : (
                <>
                  <span className="muted">Connect YouTube to browse your playlists</span>
                  <ConnectYouTubeButton />
                </>
              )}
            </div>
          </>
        )}
      </main>
    </>
  );
}
