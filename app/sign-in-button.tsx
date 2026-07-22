"use client";

import { useState } from "react";
import { Button } from "./button";
import { createClient } from "@/src/lib/supabase/client";

/** Log into your june account with Google - identity only, no YouTube access. */
export function SignInButton({ next }: { next?: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    const supabase = createClient();
    const callback = `${window.location.origin}/auth/callback${
      next ? `?next=${encodeURIComponent(next)}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback },
    });
    // On success the browser redirects to Google; only reset if it didn't.
    if (error) setPending(false);
  }

  return (
    <Button onClick={signIn} pending={pending} className="btn btn--primary btn--lg">
      Sign in with Google
    </Button>
  );
}
