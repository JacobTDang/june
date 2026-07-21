/**
 * Room liveness + staleness logic, kept pure so it can be unit-tested and
 * reused by both the metrics dashboard and the cleanup sweep.
 *
 * A room row carries a snapshot of what's "now playing" but nothing clears it
 * when everyone leaves, so an abandoned room looks like it's still playing a
 * track that actually ended hours ago. These helpers tell a genuinely live
 * room apart from that kind of zombie.
 */

export type RoomLifecycleRow = {
  id: string;
  created_at: string; // ISO timestamp
  now_playing_video_id: string | null;
  now_playing_started_at: number | null; // ms since epoch
  now_playing_duration_ms: number | null;
};

/** How long a room can sit with no live playback before it's swept. */
export const ROOM_STALE_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * A room is live only if its current track hasn't finished yet. An
 * actively-used room keeps bumping `now_playing_started_at` as tracks advance,
 * so a stale start time means nobody is there to drive playback.
 */
export function roomIsLive(room: RoomLifecycleRow, nowMs: number): boolean {
  if (!room.now_playing_video_id) return false;
  if (room.now_playing_started_at == null || room.now_playing_duration_ms == null) return false;
  return room.now_playing_started_at + room.now_playing_duration_ms > nowMs;
}

/** The most recent sign of life: the last track start, or failing that, creation. */
export function roomLastActivityMs(room: RoomLifecycleRow): number {
  const created = Date.parse(room.created_at);
  return Math.max(created, room.now_playing_started_at ?? 0);
}

/**
 * Rooms safe to delete: not currently live and untouched past the TTL. A live
 * room is never swept regardless of age. A room with unparseable `created_at`
 * yields NaN here and is therefore never flagged — we don't delete on bad data.
 */
export function deadRoomIds(
  rooms: RoomLifecycleRow[],
  nowMs: number,
  ttlMs: number = ROOM_STALE_MS,
): string[] {
  return rooms
    .filter((r) => !roomIsLive(r, nowMs) && nowMs - roomLastActivityMs(r) > ttlMs)
    .map((r) => r.id);
}
