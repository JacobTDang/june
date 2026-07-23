/**
 * Audius: an open music catalog with real, streamable audio URLs. Unlike a
 * YouTube embed, an Audius stream is a plain audio file an <audio> element can
 * play — which is what lets playback keep going with the screen off. Pure helpers
 * here; the server fetch lives in audius-fetch.ts.
 */

export const AUDIUS_HOST = "https://api.audius.co";
const APP_NAME = "june";

export interface AudiusTrack {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  durationMs: number;
  streamUrl: string;
}

/** The <audio>-playable stream URL for a track (302-redirects to the audio file). */
export function audiusStreamUrl(id: string, host: string = AUDIUS_HOST): string {
  return `${host}/v1/tracks/${encodeURIComponent(id)}/stream?app_name=${APP_NAME}`;
}

/** Parse a raw Audius track into our shape, or null if it's missing essentials. */
export function parseAudiusTrack(raw: unknown, host: string = AUDIUS_HOST): AudiusTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return null;

  const artwork = (t.artwork as Record<string, unknown> | null) ?? null;
  const art = artwork?.["480x480"] ?? artwork?.["150x150"];
  const user = (t.user as Record<string, unknown> | null) ?? null;
  const name = user?.name ?? user?.handle;

  return {
    id: t.id,
    title: t.title,
    artist: typeof name === "string" && name ? name : "Unknown artist",
    artworkUrl: typeof art === "string" ? art : null,
    durationMs: typeof t.duration === "number" ? Math.round(t.duration * 1000) : 0,
    streamUrl: audiusStreamUrl(t.id, host),
  };
}
