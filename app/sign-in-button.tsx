"use client";

import { createClient } from "@/src/lib/supabase/client";

/** Log into your june account with Google — identity only, no YouTube access. */
export function SignInButton() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
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
