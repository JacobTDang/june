"use client";

import { createClient } from "@/src/lib/supabase/client";

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export function SignInButton() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: YOUTUBE_SCOPE,
        redirectTo: `${window.location.origin}/auth/callback`,
        // Ask for a refresh token and force the scope consent screen.
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <button
      onClick={signIn}
      style={{
        padding: "0.6rem 1.1rem",
        fontSize: "1rem",
        borderRadius: 8,
        border: "1px solid #ccc",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      Sign in with Google
    </button>
  );
}
