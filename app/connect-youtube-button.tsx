"use client";

import { useState } from "react";
import { ListMusic } from "lucide-react";
import { Button } from "./button";
import { createClient } from "@/src/lib/supabase/client";

const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

/**
 * Grant june read access to your YouTube account (playlists). Runs a second
 * Google OAuth that escalates the scope; `yt=1` tells the callback to capture
 * the resulting YouTube token.
 */
export function ConnectYouTubeButton() {
  const [pending, setPending] = useState(false);

  async function connect() {
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: YOUTUBE_SCOPE,
        redirectTo: `${window.location.origin}/auth/callback?next=/playlists&yt=1`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) setPending(false);
  }

  return (
    <Button onClick={connect} pending={pending} className="btn btn--sm">
      <ListMusic size={15} />
      Connect YouTube
    </Button>
  );
}
