import { ArrowLeft } from "lucide-react";
import { DAILY_QUOTA, getAdminMetrics, isAdmin } from "@/src/lib/metrics/admin";
import { MetricsView } from "./metrics-view";

export default async function MetricsPage() {
  // Owner-only. Don't reveal the page exists to anyone else.
  if (!(await isAdmin())) {
    return (
      <main className="container">
        <p className="muted">Not found.</p>
      </main>
    );
  }

  const metrics = await getAdminMetrics();

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <h1 className="pl__title" style={{ margin: "1rem 0 0" }}>
        Metrics
      </h1>
      <MetricsView metrics={metrics} quota={DAILY_QUOTA} />
    </main>
  );
}
