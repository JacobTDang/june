import type { ImportStatus, ImportTrackState, MatchResult, TrackToMatch } from "../../audio/imports";

/**
 * What library matching sends to mp3server and writes back onto songs, as
 * pure functions. Deliberately free of Supabase and `server-only`; the IO
 * lives in ./match-store.ts and ./match-library.ts.
 */

/** The most songs per import: mp3server's import_max_tracks. */
export const MATCH_BATCH_LIMIT = 500;

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

export function importBatch(songs: readonly PendingSong[]): TrackToMatch[] {
  return songs.map((song) => {
    const artist = song.artists[0];
    if (!artist) throw new Error(`song ${song.id} has no artist to match on`);
    return { title: song.title, artist, durationMs: song.durationMs };
  });
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
    default:
      // still pending on mp3server: leave the song where it is
      return null;
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
