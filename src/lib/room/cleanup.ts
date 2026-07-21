import "server-only";
import { createServiceClient } from "../supabase/service";
import { ROOM_STALE_MS, deadRoomIds, type RoomLifecycleRow } from "./lifecycle";

const LIFECYCLE_COLS =
  "id, created_at, now_playing_video_id, now_playing_started_at, now_playing_duration_ms";

/** Read every room and return the ids that are safe to delete (see deadRoomIds). */
export async function findDeadRooms(
  nowMs: number = Date.now(),
  ttlMs: number = ROOM_STALE_MS,
): Promise<string[]> {
  const service = createServiceClient();
  const { data, error } = await service.from("rooms").select(LIFECYCLE_COLS);
  if (error) throw new Error(`findDeadRooms failed: ${error.message}`);
  return deadRoomIds((data as RoomLifecycleRow[] | null) ?? [], nowMs, ttlMs);
}

/**
 * Delete abandoned rooms. queue_items and room_participants cascade on the
 * room delete, so this also clears their orphaned queues and participant rows.
 * Runs with the service role since a sweep isn't scoped to any one participant.
 */
export async function sweepDeadRooms(
  nowMs: number = Date.now(),
  ttlMs: number = ROOM_STALE_MS,
): Promise<{ deleted: number; ids: string[] }> {
  const ids = await findDeadRooms(nowMs, ttlMs);
  if (ids.length === 0) return { deleted: 0, ids: [] };

  const service = createServiceClient();
  const { error } = await service.from("rooms").delete().in("id", ids);
  if (error) throw new Error(`sweepDeadRooms failed: ${error.message}`);
  return { deleted: ids.length, ids };
}
