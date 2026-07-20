"use client";

import { createClient } from "@/src/lib/supabase/client";

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/**
 * Grant june read access to your YouTube account (playlists). Runs a second
 * Google OAuth that escalates the scope; `yt=1` tells the callback to capture
 * the resulting YouTube token.
 */
export function ConnectYouTubeButton() {
  async function connect() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: YOUTUBE_SCOPE,
        redirectTo: `${window.location.origin}/auth/callback?next=/playlists&yt=1`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <button
      onClick={connect}
      style={{
        padding: "0.6rem 1.1rem",
        fontSize: "1rem",
        borderRadius: 8,
        border: "1px solid #c00",
        background: "#c00",
        color: "#fff",
        cursor: "pointer",
      }}
    >
      Connect your YouTube
    </button>
  );
}
