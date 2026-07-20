import { createClient } from "@/src/lib/supabase/server";
import { SignInButton } from "./sign-in-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "5rem 1.5rem" }}>
      <h1 style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>june</h1>
      <p style={{ fontSize: "1.1rem", color: "#555", marginBottom: "2rem" }}>
        A jam room for YouTube Music — listen together, in sync.
      </p>

      {user ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "flex-start" }}>
          <p style={{ margin: 0 }}>Signed in as {user.email}</p>
          <a href="/playlists" style={{ fontSize: "1.1rem" }}>
            View your playlists →
          </a>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              style={{
                padding: "0.4rem 0.9rem",
                borderRadius: 8,
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <SignInButton />
      )}
    </main>
  );
}
