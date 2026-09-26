import { after, NextResponse } from "next/server";
import { bearerMatches } from "@/src/lib/spotify/secret";
import { syncAllUsers } from "@/src/lib/spotify/sync";

export const maxDuration = 300;

/**
 * Called by pg_cron every 30 minutes. Answers at once and syncs after the
 * response: pg_net gives up on a request after 10 seconds, and a first sync
 * can take longer than that.
 */
export async function POST(request: Request) {
  const secret = process.env.SPOTIFY_SYNC_SECRET;
  if (!secret) {
    console.error("SPOTIFY_SYNC_SECRET is not set; refusing to sync.");
    return NextResponse.json({ error: "sync is not configured" }, { status: 500 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await syncAllUsers();
      if (result.status === "busy") {
        console.warn("Spotify sync skipped: a previous run still holds the lease.");
      }
    } catch (err) {
      console.error("Spotify sync run failed:", err);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
