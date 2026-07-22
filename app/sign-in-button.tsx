"use client";

import { createClient } from "@/src/lib/supabase/client";

/** Log into your june account with Google — identity only, no YouTube access. */
export function SignInButton({ next }: { next?: string }) {
  async function signIn() {
    const supabase = createClient();
    const callback = `${window.location.origin}/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback },
    });
  }

  return (
    <button onClick={signIn} className="btn btn--primary btn--lg">
      Sign in with Google
    </button>
  );
}
