import { cookies } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
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

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const youtubeConnected = Boolean((await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value);

  return (
    <main className="container">
      <h1 className="display">june</h1>
      <p className="lead">A jam room for YouTube Music — listen together, in sync.</p>

      {!user ? (
        <SignInButton />
      ) : (
        <div className="stack" style={{ gap: "2rem" }}>
          <div className="stack">
            <h2 style={{ fontSize: "1.25rem" }}>Start listening</h2>
            <CreateJamButton displayName={displayNameOf(user)} />
            <JoinJamForm />
          </div>

          <div className="stack">
            {youtubeConnected ? (
              <>
                <span className="pill">
                  <span className="pill__dot" />
                  YouTube connected
                </span>
                <a href="/playlists" className="btn">
                  Your playlists →
                </a>
              </>
            ) : (
              <>
                <p className="muted">Connect YouTube to add your library to a jam.</p>
                <ConnectYouTubeButton />
              </>
            )}
          </div>

          <div className="stack">
            <p className="muted">Signed in as {user.email}</p>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
