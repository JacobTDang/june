import type { AdminMetrics } from "@/src/lib/metrics/admin";

const ENDPOINT_LABELS: Record<string, string> = {
  search: "Search",
  videos: "Video details",
  playlists: "Playlists",
  playlistItems: "Playlist items",
};

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="tile">
      <div className="tile__val">{value.toLocaleString()}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

export function MetricsView({ metrics, quota }: { metrics: AdminMetrics; quota: number }) {
  const { today, recent, stats } = metrics;
  const pct = Math.min(100, Math.round((today.units / quota) * 100));
  const over = today.units / quota >= 0.8;

  const endpoints = Object.entries(today.byEndpoint).sort((a, b) => b[1] - a[1]);
  const maxEndpoint = Math.max(1, ...endpoints.map(([, u]) => u));

  const days = [...recent].reverse(); // oldest → newest
  const maxDay = Math.max(1, ...days.map((d) => d.units));

  return (
    <div className="metrics">
      <section>
        <div className="eyebrow">YouTube quota · today ({today.day} PT)</div>
        <div className="quota__num">
          {today.units.toLocaleString()}
          <span className="quota__cap"> / {quota.toLocaleString()} units</span>
        </div>
        <div className="meter" role="meter" aria-valuenow={today.units} aria-valuemax={quota}>
          <div
            className={`meter__fill${over ? " meter__fill--over" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="quota__pct">{pct}% used</div>

        {endpoints.length > 0 && (
          <div className="breakdown">
            {endpoints.map(([endpoint, units]) => (
              <div className="brk" key={endpoint}>
                <span className="brk__label">{ENDPOINT_LABELS[endpoint] ?? endpoint}</span>
                <div className="brk__bar">
                  <div
                    className="brk__fill"
                    style={{ width: `${Math.max(2, (units / maxEndpoint) * 100)}%` }}
                    title={`${units} units`}
                  />
                </div>
                <span className="brk__val">{units.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="eyebrow">Last 7 days</div>
        {days.length === 0 ? (
          <p className="muted">No usage recorded yet.</p>
        ) : (
          <div className="spark">
            {days.map((d) => (
              <div className="spark__col" key={d.day} title={`${d.day}: ${d.units.toLocaleString()} units`}>
                <div
                  className="spark__bar"
                  style={{ height: `${Math.max(2, (d.units / maxDay) * 100)}%` }}
                />
                <span className="spark__day">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="eyebrow">App</div>
        <div className="tiles">
          <StatTile label="Rooms" value={stats.rooms} />
          <StatTile label="Active now" value={stats.activeRooms} />
          <StatTile label="Users" value={stats.users} />
          <StatTile label="Friendships" value={stats.friendships} />
          <StatTile label="Queued tracks" value={stats.queued} />
        </div>
      </section>
    </div>
  );
}
