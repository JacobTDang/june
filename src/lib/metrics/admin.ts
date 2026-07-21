import "server-only";
import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import { pacificDay } from "./day";

/** YouTube Data API default daily quota. */
export const DAILY_QUOTA = 10000;

export type QuotaDay = { day: string; units: number; byEndpoint: Record<string, number> };

export interface AdminMetrics {
  today: QuotaDay;
  recent: QuotaDay[];
  stats: {
    rooms: number;
    activeRooms: number;
    users: number;
    friendships: number;
    queued: number;
  };
}

/** Whether the signed-in user is the configured owner (ADMIN_EMAIL). */
export async function isAdmin(): Promise<boolean> {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!admin) return false;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return Boolean(user?.email && user.email.toLowerCase() === admin);
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

  const [rooms, activeRooms, users, friendships, queued] = await Promise.all([
    service.from("rooms").select("id", { count: "exact", head: true }),
    service
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .not("now_playing_video_id", "is", null),
    service.from("profiles").select("id", { count: "exact", head: true }),
    service
      .from("friendships")
      .select("requester", { count: "exact", head: true })
      .eq("status", "accepted"),
    service.from("queue_items").select("id", { count: "exact", head: true }),
  ]);

  return {
    today: todayRow ? toQuotaDay(todayRow) : { day: today, units: 0, byEndpoint: {} },
    recent: rows.map(toQuotaDay),
    stats: {
      rooms: rooms.count ?? 0,
      activeRooms: activeRooms.count ?? 0,
      users: users.count ?? 0,
      friendships: friendships.count ?? 0,
      queued: queued.count ?? 0,
    },
  };
}
