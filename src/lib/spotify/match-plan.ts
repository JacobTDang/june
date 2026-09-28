import type { ImportStatus, ImportTrackState, MatchResult, TrackToMatch } from "../../audio/imports";

/**
 * What library matching sends to mp3server and writes back onto songs, as
 * pure functions. Deliberately free of Supabase and `server-only`; the IO
 * lives in ./match-store.ts and ./match-library.ts.
 */

/** The most songs per import: mp3server's import_max_tracks. */
export const MATCH_BATCH_LIMIT = 500;

/** A failed match (a bot check, an outage) goes back in line after this long. */
export const FAILED_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** mp3server's TrackIn limit on a title or an artist, in characters. It
 *  refuses the whole import if one track is over it. */
export const MAX_TRACK_TEXT = 500;

export interface PendingSong {
  id: string;
  title: string;
  artists: string[];
  durationMs: number | null;
}

/** A song waiting on an import, and its index in that import. */
export interface MatchingSong {
  id: string;
  position: number;
}

export type SongMatchUpdate =
  | {
      songId: string;
      state: "matched";
      videoId: string;
      videoDurationMs: number;
      confidence: "high" | "low";
    }
  // "pending" puts a song back in line: its import was cancelled or is gone
  | { songId: string; state: "not_found" | "failed" | "pending" };

/** Trimmed and cut to the limit. Counted in code points, as Python counts a
 *  string's length, so a cut never splits an emoji. */
function trackText(text: string | undefined): string {
  return Array.from((text ?? "").trim()).slice(0, MAX_TRACK_TEXT).join("");
}

/** What mp3server is sent for a song: its title, first artist and Spotify
 *  length. Null when the title or artist is blank, which mp3server refuses. */
export function sendableTrack(song: PendingSong): TrackToMatch | null {
  const title = trackText(song.title);
  const artist = trackText(song.artists[0]);
  if (title === "" || artist === "") return null;
  return { title, artist, durationMs: song.durationMs };
}

export interface ImportBatch {
  /** What is submitted. A song's index here is its match_position. */
  tracks: TrackToMatch[];
  /** The submitted songs' ids, in the same order as tracks. */
  sendable: string[];
  /** Songs that can't be sent. One of them would get the whole import refused. */
  unsendable: string[];
}

export function importBatch(songs: readonly PendingSong[]): ImportBatch {
  const batch: ImportBatch = { tracks: [], sendable: [], unsendable: [] };
  for (const song of songs) {
    const track = sendableTrack(song);
    if (track === null) {
      batch.unsendable.push(song.id);
      continue;
    }
    batch.tracks.push(track);
    batch.sendable.push(song.id);
  }
  return batch;
}

/** A resolved answer is playable only with a video and its length: the room
 *  clock ends a track on the audio's own length. */
function matched(
  songId: string,
  videoId: string | null | undefined,
  lengthMs: number | null | undefined,
  confidence: string | null | undefined,
): SongMatchUpdate {
  if (!videoId || lengthMs == null) return { songId, state: "failed" };
  return {
    songId,
    state: "matched",
    videoId,
    videoDurationMs: lengthMs,
    confidence: confidence === "high" ? "high" : "low",
  };
}

function fromTrack(songId: string, track: ImportTrackState): SongMatchUpdate | null {
  switch (track.state) {
    case "resolved":
      return matched(songId, track.video_id, track.matched_duration_ms, track.confidence);
    case "not_found":
      return { songId, state: "not_found" };
    case "failed":
      return { songId, state: "failed" };
    case "canceled":
      return { songId, state: "pending" };
    case "pending":
      // still pending on mp3server: leave the song where it is
      return null;
    default:
      throw new Error(`song ${songId}: import track has an unknown state "${track.state}"`);
  }
}

/**
 * The updates one import's results mean for its songs. An import the server
 * no longer has (null) sends every song back to pending, so the next batch
 * picks them up again; mp3server's cache makes that cheap.
 */
export function updatesFromImport(
  songs: readonly MatchingSong[],
  status: ImportStatus | null,
): SongMatchUpdate[] {
  if (status === null) return songs.map((song) => ({ songId: song.id, state: "pending" }));
  const updates: SongMatchUpdate[] = [];
  for (const song of songs) {
    const track = status.tracks[song.position];
    if (!track) throw new Error(`import ${status.id} has no track at position ${song.position}`);
    const update = fromTrack(song.id, track);
    if (update !== null) updates.push(update);
  }
  return updates;
}

export function matchResultUpdate(songId: string, result: MatchResult): SongMatchUpdate {
  if (result.state === "not_found") return { songId, state: "not_found" };
  return matched(songId, result.video_id, result.matched_duration_ms, result.confidence);
}

/** One element of apply_song_matches' jsonb argument. */
export function matchUpdateRow(update: SongMatchUpdate): {
  song_id: string;
  state: string;
  video_id: string | null;
  video_duration_ms: number | null;
  confidence: string | null;
} {
  if (update.state === "matched") {
    return {
      song_id: update.songId,
      state: update.state,
      video_id: update.videoId,
      video_duration_ms: update.videoDurationMs,
      confidence: update.confidence,
    };
  }
  return { song_id: update.songId, state: update.state, video_id: null, video_duration_ms: null, confidence: null };
}
