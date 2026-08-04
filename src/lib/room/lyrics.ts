"use server";

import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import { cleanArtist, cleanTitle, pickBestMatch, type LyricsCandidate } from "@/src/lyrics/match";

/** LRCLIB is a free, community-run lyrics database — no key, no quota. It asks
 *  callers to identify themselves, which is only polite. */
const LRCLIB = "https://lrclib.net/api";
const USER_AGENT = "june (https://june-jam.vercel.app)";

export interface TrackLyrics {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

interface LrclibRow {
  trackName: string;
  artistName: string;
  duration: number | null;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

/**
 * Lyrics for a track, from cache when we've looked before. A miss is cached
 * too — as a row with no lyrics — so a track nobody has words for doesn't
 * re-ask the provider every time the room plays it.
 */
export async function getTrackLyrics(track: {
  videoId: string;
  title: string;
  artist: string | null;
  durationMs: number;
}): Promise<TrackLyrics> {
  const supabase = await createClient();
  const { data: cached } = await supabase
    .from("lyrics_cache")
    .select("synced_lyrics, plain_lyrics")
    .eq("video_id", track.videoId)
    .maybeSingle();

  if (cached) {
    const row = cached as { synced_lyrics: string | null; plain_lyrics: string | null };
    return { syncedLyrics: row.synced_lyrics, plainLyrics: row.plain_lyrics };
  }

  const found = await lookup(track);

  // Written with the service role, like the other shared caches: a signed-in
  // user must not be able to write lyrics everyone else will read.
  await createServiceClient()
    .from("lyrics_cache")
    .upsert({
      video_id: track.videoId,
      synced_lyrics: found?.syncedLyrics ?? null,
      plain_lyrics: found?.plainLyrics ?? null,
      source: "lrclib",
      fetched_at: new Date().toISOString(),
    });

  return {
    syncedLyrics: found?.syncedLyrics ?? null,
    plainLyrics: found?.plainLyrics ?? null,
  };
}

/** Exact lookup first, then a search — YouTube titles rarely match a lyrics
 *  database head-on, but the search endpoint copes with the noise. */
async function lookup(track: {
  title: string;
  artist: string | null;
  durationMs: number;
}): Promise<LyricsCandidate | null> {
  const title = cleanTitle(track.title);
  const artist = cleanArtist(track.artist ?? "");
  if (title === "") return null;

  if (artist !== "") {
    const exact = await request(
      `${LRCLIB}/get?${new URLSearchParams({
        artist_name: artist,
        track_name: title,
        duration: String(Math.round(track.durationMs / 1000)),
      })}`,
    );
    const one = toCandidates(exact);
    const picked = pickBestMatch(one, { durationMs: track.durationMs });
    if (picked) return picked;
  }

  const results = await request(
    `${LRCLIB}/search?${new URLSearchParams({ q: [title, artist].filter(Boolean).join(" ") })}`,
  );
  return pickBestMatch(toCandidates(results), { durationMs: track.durationMs });
}

/** One provider call. A miss (404) and a provider outage are both "no lyrics
 *  right now" — neither is worth failing a room over. */
async function request(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function toCandidates(json: unknown): LyricsCandidate[] {
  const rows: LrclibRow[] = Array.isArray(json)
    ? (json as LrclibRow[])
    : json !== null && typeof json === "object"
      ? [json as LrclibRow]
      : [];

  return rows
    .filter((row) => typeof row?.trackName === "string")
    .map((row) => ({
      trackName: row.trackName,
      artistName: row.artistName,
      durationSeconds: row.duration ?? 0,
      syncedLyrics: row.syncedLyrics ?? null,
      plainLyrics: row.plainLyrics ?? null,
    }));
}
