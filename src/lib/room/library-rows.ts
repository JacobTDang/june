import type { AddTrackInput } from "./types";

/**
 * How library songs look and queue in a room, as pure functions. The server
 * actions that use them are in ./library.ts.
 */

/** The songs columns a room reads. */
export interface SongForRoom {
  id: string;
  title: string;
  artists: string[];
  artwork_url: string | null;
  duration_ms: number | null;
  match_state: string;
  video_id: string | null;
  video_duration_ms: number | null;
  match_confidence: string | null;
}

export type LibraryRowState = "ready" | "matching" | "unavailable";

/** Where a song stands with matching, for any list that shows it. */
export interface SongMatchView {
  state: LibraryRowState;
  lowConfidence: boolean;
}

export interface LibraryRow extends SongMatchView {
  songId: string;
  title: string;
  artists: string;
  artworkUrl: string | null;
}

type MatchColumns = Pick<SongForRoom, "match_state" | "video_id" | "video_duration_ms" | "match_confidence">;

function isReady(song: MatchColumns): boolean {
  return song.match_state === "matched" && song.video_id !== null && song.video_duration_ms !== null;
}

export function matchView(song: MatchColumns): SongMatchView {
  const state: LibraryRowState = isReady(song)
    ? "ready"
    : song.match_state === "pending" || song.match_state === "matching"
      ? "matching"
      : "unavailable";
  return { state, lowConfidence: song.match_confidence === "low" };
}

export function toLibraryRow(song: SongForRoom): LibraryRow {
  return {
    songId: song.id,
    title: song.title,
    artists: song.artists.join(", "),
    artworkUrl: song.artwork_url,
    ...matchView(song),
  };
}

/** What enqueueTrack needs for a ready song. The length is the matched
 *  video's: the room clock ends a track on the audio, not on Spotify's
 *  number. */
export function trackFromSong(song: SongForRoom): AddTrackInput | null {
  if (!isReady(song) || song.video_id === null || song.video_duration_ms === null) return null;
  return {
    videoId: song.video_id,
    title: song.title,
    artist: song.artists.join(", "),
    durationMs: song.video_duration_ms,
    thumbnailUrl: song.artwork_url ?? undefined,
  };
}

export function rowNote(view: SongMatchView): string {
  if (view.state === "matching") return " · matching…";
  if (view.state === "unavailable") return " · no match found";
  return view.lowConfidence ? " · ?" : "";
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function rowMatchesFilter(row: LibraryRow, filter: string): boolean {
  const needle = fold(filter.trim());
  if (needle === "") return true;
  return fold(`${row.title} ${row.artists}`).includes(needle);
}

export function playlistQueueSummary(counts: {
  added: number;
  ready: number;
  matching: number;
  unavailable: number;
}): string {
  const parts = [`Added ${counts.added}`];
  const alreadyThere = counts.ready - counts.added;
  if (alreadyThere > 0) parts.push(`${alreadyThere} already in the room`);
  if (counts.matching > 0) parts.push(`${counts.matching} still matching`);
  if (counts.unavailable > 0) parts.push(`${counts.unavailable} not found`);
  return parts.join(" · ");
}
