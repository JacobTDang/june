import { cookies } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
import { SignInButton } from "./sign-in-button";
import { ConnectYouTubeButton } from "./connect-youtube-button";

const button = {
  padding: "0.4rem 0.9rem",
  borderRadius: 8,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
} as const;

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const youtubeConnected = Boolean((await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value);

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.5rem" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>june</h1>
      <p style={{ fontSize: "1.1rem", color: "#555", marginBottom: "2rem" }}>
        A jam room for YouTube Music — listen together, in sync.
      </p>

      {!user ? (
        <SignInButton />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>
            Signed in as {user.email}
            {youtubeConnected && (
              <span style={{ color: "#0a0" }}> · YouTube connected ✓</span>
            )}
          </p>

          {youtubeConnected ? (
            <a href="/playlists" style={{ fontSize: "1.1rem" }}>
              View your playlists →
            </a>
          ) : (
            <>
              <p style={{ margin: 0, color: "#555" }}>
                Connect YouTube to import your playlists into a jam.
              </p>
              <ConnectYouTubeButton />
            </>
          )}

          <form action="/auth/signout" method="post">
            <button type="submit" style={button}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
