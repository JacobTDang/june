import "server-only";
import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
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

  const [health, users, friendships, queued] = await Promise.all([
    // Counts computed in one bounded query; "active" means a track that's still
    // playing, "stale" means sweepable — the same predicate the cron deletes on.
    service.rpc("room_health"),
    service.from("profiles").select("id", { count: "exact", head: true }),
    service
      .from("friendships")
      .select("requester", { count: "exact", head: true })
      .eq("status", "accepted"),
    service.from("queue_items").select("id", { count: "exact", head: true }),
  ]);

  const h = (health.data as { total: number; active: number; stale: number }[] | null)?.[0];

  return {
    today: todayRow ? toQuotaDay(todayRow) : { day: today, units: 0, byEndpoint: {} },
    recent: rows.map(toQuotaDay),
    stats: {
      rooms: Number(h?.total ?? 0),
      activeRooms: Number(h?.active ?? 0),
      staleRooms: Number(h?.stale ?? 0),
      users: users.count ?? 0,
      friendships: friendships.count ?? 0,
      queued: queued.count ?? 0,
    },
  };
}
