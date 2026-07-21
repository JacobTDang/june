import "server-only";
import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import { deadRoomIds, roomIsLive, type RoomLifecycleRow } from "../room/lifecycle";
import { isAdminIdentity } from "./admin-identity";
import { pacificDay } from "./day";

/** YouTube Data API default daily quota. */
export const DAILY_QUOTA = 10000;

export type QuotaDay = { day: string; units: number; byEndpoint: Record<string, number> };

export interface AdminMetrics {
  today: QuotaDay;
  recent: QuotaDay[];
  stats: {
    rooms: number;
    /** Rooms whose current track hasn't ended — genuinely playing right now. */
    activeRooms: number;
    /** Abandoned rooms that the cleanup sweep would delete. */
    staleRooms: number;
    users: number;
    friendships: number;
    queued: number;
  };
}

/** Whether the signed-in user is the configured owner (ADMIN_EMAIL). */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminIdentity(
    user ? { email: user.email ?? null, emailConfirmed: Boolean(user.email_confirmed_at) } : null,
    process.env.ADMIN_EMAIL,
  );
}

type UsageRow = { day: string; units: number; by_endpoint: Record<string, number> };
const toQuotaDay = (r: UsageRow): QuotaDay => ({
  day: r.day,
  units: r.units,
  byEndpoint: r.by_endpoint ?? {},
});

/** App-wide metrics, read with the service role so counts aren't RLS-limited. */
export async function getAdminMetrics(): Promise<AdminMetrics> {
  const service = createServiceClient();
  const today = pacificDay();

  const { data: usage } = await service
    .from("youtube_usage")
    .select("day, units, by_endpoint")
    .order("day", { ascending: false })
    .limit(7);
  const rows = (usage as UsageRow[] | null) ?? [];
  const todayRow = rows.find((r) => r.day === today);

  const [roomRows, users, friendships, queued] = await Promise.all([
    // Pull the timing columns so "active" means a track that's actually still
    // playing — not just a stale now_playing snapshot from an abandoned room.
    service
      .from("rooms")
      .select("id, created_at, now_playing_video_id, now_playing_started_at, now_playing_duration_ms"),
    service.from("profiles").select("id", { count: "exact", head: true }),
    service
      .from("friendships")
      .select("requester", { count: "exact", head: true })
      .eq("status", "accepted"),
    service.from("queue_items").select("id", { count: "exact", head: true }),
  ]);

  const rooms = (roomRows.data as RoomLifecycleRow[] | null) ?? [];
  const now = Date.now();

  return {
    today: todayRow ? toQuotaDay(todayRow) : { day: today, units: 0, byEndpoint: {} },
    recent: rows.map(toQuotaDay),
    stats: {
      rooms: rooms.length,
      activeRooms: rooms.filter((r) => roomIsLive(r, now)).length,
      staleRooms: deadRoomIds(rooms, now).length,
      users: users.count ?? 0,
      friendships: friendships.count ?? 0,
      queued: queued.count ?? 0,
    },
  };
}
