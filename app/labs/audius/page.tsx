import type { Metadata } from "next";
import { getAudiusTracks } from "@/src/lib/audius-fetch";
import { AudiusPlayer } from "./audius-player";

export const metadata: Metadata = { title: "june labs · Background audio (Audius)" };

/**
 * Throwaway proof-of-concept: play music that keeps going with the screen off,
 * using Audius's real audio streams through a plain <audio> element. Not wired
 * into rooms — a standalone page to feel the catalog tradeoff on a phone.
 */
export default async function AudiusLabPage() {
  let tracks: Awaited<ReturnType<typeof getAudiusTracks>> = [];
  let error: string | null = null;
  try {
    tracks = await getAudiusTracks();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main className="lab">
      <header className="lab-head">
        <span className="eyebrow">june labs · proof of concept</span>
        <h1 className="lab-title">Background audio, on Audius</h1>
        <p className="lab-lead">
          Tap a track, then lock your phone or switch apps — it keeps playing, with lock-screen
          controls. That’s the thing a YouTube embed can’t do. Real Audius catalog, no login.
        </p>
      </header>

      {error ? (
        <p className="muted">Couldn’t reach Audius: {error}</p>
      ) : tracks.length === 0 ? (
        <p className="muted">No tracks found.</p>
      ) : (
        <AudiusPlayer initialTracks={tracks} />
      )}
    </main>
  );
}
