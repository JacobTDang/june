/**
 * Client-facing room shapes and the pure mappers from Supabase rows. The room
 * is a database projection of the jam concept: `rooms` holds the shared
 * playback clock, `queue_items` the FIFO queue, `room_participants` presence.
 */

export interface AddTrackInput {
  videoId: string;
  title: string;
  artist?: string;
  durationMs: number;
  thumbnailUrl?: string;
}

export interface QueueTrack {
  id: string;
  videoId: string;
  title: string;
  artist?: string;
  durationMs: number;
  thumbnailUrl?: string;
  addedByName?: string;
}

export interface RoomNowPlaying {
  videoId: string;
  title: string;
  artist?: string;
  durationMs: number;
  thumbnailUrl?: string;
  addedByName?: string;
  /** Epoch ms on the server clock when this track began. */
  startedAt: number;
}

export interface RoomParticipant {
  userId: string;
  name: string;
  avatarUrl?: string | null;
}

export interface RoomState {
  id: string;
  nowPlaying: RoomNowPlaying | null;
  queue: QueueTrack[];
  participants: RoomParticipant[];
}

export interface RoomRow {
  id: string;
  now_playing_video_id: string | null;
  now_playing_title: string | null;
  now_playing_artist: string | null;
  now_playing_duration_ms: number | null;
  now_playing_thumbnail_url: string | null;
  now_playing_started_at: number | null;
  now_playing_added_by_name: string | null;
}

export interface QueueItemRow {
  id: string;
  video_id: string;
  title: string;
  artist: string | null;
  duration_ms: number;
  thumbnail_url: string | null;
  added_by_name: string | null;
}

export interface ParticipantRow {
  user_id: string;
  name: string | null;
}

export function rowToNowPlaying(row: RoomRow): RoomNowPlaying | null {
  if (
    row.now_playing_video_id === null ||
    row.now_playing_duration_ms === null ||
    row.now_playing_started_at === null
  ) {
    return null;
  }
  return {
    videoId: row.now_playing_video_id,
    title: row.now_playing_title ?? "",
    artist: row.now_playing_artist ?? undefined,
    durationMs: row.now_playing_duration_ms,
    thumbnailUrl: row.now_playing_thumbnail_url ?? undefined,
    addedByName: row.now_playing_added_by_name ?? undefined,
    startedAt: row.now_playing_started_at,
  };
}

export function rowToQueueTrack(row: QueueItemRow): QueueTrack {
  return {
    id: row.id,
    videoId: row.video_id,
    title: row.title,
    artist: row.artist ?? undefined,
    durationMs: row.duration_ms,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    addedByName: row.added_by_name ?? undefined,
  };
}

export function rowToParticipant(row: ParticipantRow): RoomParticipant {
  return { userId: row.user_id, name: row.name ?? "Guest" };
}
