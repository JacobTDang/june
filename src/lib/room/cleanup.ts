import "server-only";
import { createServiceClient } from "../supabase/service";

/**
 * Delete abandoned rooms with no live playback past the TTL. This is the same
 * `sweep_dead_rooms()` SQL function the hourly pg_cron job runs, so the manual
 * owner sweep and the scheduled sweep share one implementation. queue_items and
 * room_participants cascade with the room delete. Returns the number deleted.
 */
export async function sweepDeadRooms(): Promise<number> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("sweep_dead_rooms");
  if (error) throw new Error(`sweepDeadRooms failed: ${error.message}`);
  return (data as number | null) ?? 0;
}
