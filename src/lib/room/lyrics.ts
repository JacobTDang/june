"use server";

import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import { captionsToLines } from "@/src/lyrics/captions";
import { cleanArtist, cleanTitle, pickBestMatch, type LyricsCandidate } from "@/src/lyrics/match";

/** LRCLIB is a free, community-run lyrics database — no key, no quota. It asks
 *  callers to identify themselves, which is only polite. */
const LRCLIB = "https://lrclib.net/api";
const USER_AGENT = "june (https://june-jam.vercel.app)";

/** Below this, a caption track is a title card or a spoken intro, not lyrics. */
const MIN_CAPTION_LINES = 4;

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

  // The video's own captions first: they're timed against the exact upload
  // being streamed, so they can't land an intro out the way a database file
  // matched on title and duration can.
  const fromCaptions = await captionLyrics(track.videoId);
  if (fromCaptions !== null) {
    await store(track.videoId, { syncedLyrics: fromCaptions, plainLyrics: null }, "youtube-captions");
    return { syncedLyrics: fromCaptions, plainLyrics: null };
  }

  const found = await lookup(track);

  await store(
    track.videoId,
    { syncedLyrics: found?.syncedLyrics ?? null, plainLyrics: found?.plainLyrics ?? null },
    "lrclib",
  );

  return {
    syncedLyrics: found?.syncedLyrics ?? null,
    plainLyrics: found?.plainLyrics ?? null,
  };
}

/** Written with the service role, like the other shared caches: a signed-in
 *  user must not be able to write lyrics everyone else will read. */
async function store(videoId: string, lyrics: TrackLyrics, source: string): Promise<void> {
  await createServiceClient().from("lyrics_cache").upsert({
    video_id: videoId,
    synced_lyrics: lyrics.syncedLyrics,
    plain_lyrics: lyrics.plainLyrics,
    source,
    fetched_at: new Date().toISOString(),
  });
}

/**
 * The video's caption track as LRC, or null when it has none worth using.
 * A caption track that is nothing but "[Music]" narration yields no lines,
 * which is a fallback case, not a result.
 */
async function captionLyrics(videoId: string): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
  if (!baseUrl) return null;

  try {
    const supabase = await createClient();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return null;

    const response = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/captions/${encodeURIComponent(videoId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as { cues?: { start_ms: number; text: string }[] };
    const lines = captionsToLines(
      (payload.cues ?? []).map((cue) => ({ startMs: cue.start_ms, text: cue.text })),
    );
    // One or two stray lines aren't a lyric track — usually a title card or a
    // spoken intro — and would look broken next to a song that never updates.
    if (lines.length < MIN_CAPTION_LINES) return null;

    return toLrc(lines);
  } catch {
    // Captions are an optimisation; a failure just means the database path.
    return null;
  }
}

/** Rendered back to LRC so both sources share one downstream format. */
function toLrc(lines: { timeMs: number; text: string }[]): string {
  return lines
    .map(({ timeMs, text }) => {
      const totalSeconds = timeMs / 1000;
      const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
      const seconds = (totalSeconds % 60).toFixed(2).padStart(5, "0");
      return `[${minutes}:${seconds}]${text}`;
    })
    .join("\n");
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
