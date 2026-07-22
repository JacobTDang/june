/** A single track in a jam. YouTube tracks are addressed by their video id. */
export interface Track {
  /** Unique id of this entry within the jam (used for queue operations). */
  id: string;
  /** YouTube video id - what the IFrame player actually loads. */
  videoId: string;
  title: string;
  /** Length of the track in milliseconds. Must be > 0. */
  durationMs: number;
  /** Participant id of whoever added the track. */
  addedBy: string;
  /** Optional display metadata (e.g. from a pulled YouTube playlist). */
  artist?: string;
  thumbnailUrl?: string;
}

/** Someone currently in the jam room. */
export interface Participant {
  id: string;
  name: string;
  /** Timestamp (ms) when they joined. */
  joinedAt: number;
}

/** The track playing right now and when it started, on the shared clock. */
export interface NowPlaying {
  track: Track;
  /** Server timestamp (ms) when this track began. Position = now - startedAt. */
  startedAt: number;
}

/**
 * The full state of a jam room. This is the single source of truth that the
 * transport layer (Supabase Realtime) broadcasts to every member; clients
 * derive their local playback position from `nowPlaying`.
 *
 * Invariant: `nowPlaying === null` if and only if there is nothing to play,
 * in which case `queue` is empty.
 */
export interface Jam {
  id: string;
  participants: Participant[];
  /** Upcoming tracks in play order (FIFO). Empty while idle. */
  queue: Track[];
  nowPlaying: NowPlaying | null;
}
