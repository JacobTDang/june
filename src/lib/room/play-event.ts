/** Turning what happened in a room into what gets remembered.
 *
 *  Pure on purpose: the decision of whether a play counts, and how a history
 *  reads back, is the part worth testing. The Supabase calls around it are
 *  thin. */

/**
 * Below this, a play says "not this one" rather than "I listened to this".
 * Recording a two-second skip would poison both the history someone reads back
 * and the artists we suggest from.
 */
export const MIN_LISTENED_MS = 5_000;

export interface PlayedTrack {
  videoId: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  genre?: string | null;
  artistId?: string | null;
  durationMs: number;
  /** Epoch ms the shared clock started, or null if it never did. */
  startedAt: number | null;
  addedBy?: string | null;
}

export interface PlayEvent {
  videoId: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  genre: string | null;
  artistId: string | null;
  listenedMs: number;
  durationMs: number;
  skipped: boolean;
  addedBy: string | null;
}

/**
 * The play worth recording, or null when there isn't one. Null covers a track
 * that never started (still downloading when it was removed), a clock that
 * disagrees with itself, and a skip so early nobody heard the song.
 */
export function playEvent({
  track,
  endedAt,
  skipped,
}: {
  track: PlayedTrack;
  endedAt: number;
  skipped: boolean;
}): PlayEvent | null {
  if (track.startedAt === null) return null;

  const elapsed = endedAt - track.startedAt;
  // A room can sit on a finished track until some client notices and advances
  // it; that overhang is not listening.
  const listenedMs = Math.min(Math.max(0, elapsed), Math.max(0, track.durationMs));
  if (listenedMs < MIN_LISTENED_MS) return null;

  return {
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    thumbnailUrl: track.thumbnailUrl,
    genre: track.genre ?? null,
    artistId: track.artistId ?? null,
    listenedMs,
    durationMs: track.durationMs,
    skipped,
    addedBy: track.addedBy ?? null,
  };
}

/** One row of history as it comes back from the database. */
export interface PlayRow {
  roomId: string;
  videoId: string;
  title: string;
  artist: string | null;
  thumbnailUrl: string | null;
  /** ISO 8601, as Postgres sends a timestamptz. */
  playedAt: string;
  userId: string;
  userName: string;
}

export interface ArtistCount {
  artist: string;
  plays: number;
}

/**
 * Most-played artists first. Names are matched case- and space-insensitively
 * so one artist doesn't split across spellings, but the first spelling seen is
 * what gets shown — it's the one written the way the source had it.
 */
export function topArtists(rows: readonly PlayRow[], limit = 5): ArtistCount[] {
  const counts = new Map<string, ArtistCount>();

  for (const { artist } of rows) {
    const name = artist?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.plays += 1;
    else counts.set(key, { artist: name, plays: 1 });
  }

  return [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, limit);
}

export interface PastJam {
  roomId: string;
  /** ISO 8601 of the most recent play in that room. */
  lastPlayedAt: string;
  trackCount: number;
  /** Display names of everyone else who was there. */
  others: string[];
}

/**
 * A room's plays folded into one remembered jam. There is a row per listener
 * per track, so tracks are counted distinctly and everyone but `meId` becomes
 * the "with" list. Rooms themselves are long deleted by the time this is read,
 * which is why these are memories rather than links.
 */
export function groupPastJams(rows: readonly PlayRow[], meId: string): PastJam[] {
  const jams = new Map<
    string,
    { lastPlayedAt: string; tracks: Set<string>; others: Map<string, string> }
  >();

  for (const row of rows) {
    let jam = jams.get(row.roomId);
    if (!jam) {
      jam = { lastPlayedAt: row.playedAt, tracks: new Set(), others: new Map() };
      jams.set(row.roomId, jam);
    }
    jam.tracks.add(row.videoId);
    if (row.playedAt > jam.lastPlayedAt) jam.lastPlayedAt = row.playedAt;
    if (row.userId !== meId) jam.others.set(row.userId, row.userName);
  }

  return [...jams.entries()]
    .map(([roomId, jam]) => ({
      roomId,
      lastPlayedAt: jam.lastPlayedAt,
      trackCount: jam.tracks.size,
      others: [...jam.others.values()],
    }))
    .sort((a, b) => (a.lastPlayedAt < b.lastPlayedAt ? 1 : -1));
}
