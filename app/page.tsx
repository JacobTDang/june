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
    <main className="container hero rise">
      <h1 className="display">
        june
      </h1>
      <p className="lead">
        Play the same song, at the same second, with your friends.
      </p>

      {!user ? (
        <div className="stack" style={{ marginTop: "2.5rem" }}>
          <SignInButton />
          <span className="faint" style={{ fontSize: "0.85rem" }}>
            Sign in to start a room — your friends join with a code.
          </span>
        </div>
      ) : (
        <div className="stack" style={{ marginTop: "2.5rem", gap: "1.5rem", width: "100%" }}>
          <CreateJamButton displayName={displayNameOf(user)} />

          <div
            className="stack"
            style={{ gap: "0.5rem", width: "100%", maxWidth: "22rem" }}
          >
            <span className="faint" style={{ fontSize: "0.8rem", letterSpacing: "0.02em" }}>
              or join a friend&apos;s room
            </span>
            <JoinJamForm />
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem 1.25rem",
              alignItems: "center",
              marginTop: "1.5rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid var(--line)",
              width: "100%",
              fontSize: "0.85rem",
            }}
          >
            {youtubeConnected ? (
              <>
                <span className="pill">
                  <span className="pill__dot" />
                  YouTube connected
                </span>
                <a href="/playlists" className="muted">
                  Your playlists →
                </a>
              </>
            ) : (
              <ConnectYouTubeButton />
            )}
            <span style={{ flex: 1 }} />
            <span className="faint">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn btn--sm">
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
