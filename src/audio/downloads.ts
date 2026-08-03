import { parseVideoId } from "../youtube/url";
import type { DownloadJob } from "./schema";

/** Only the fields this mapping reads. Narrowing here (rather than
 *  re-declaring the job shape) keeps one definition of the wire format while
 *  still stating exactly what this function depends on. */
export type DownloadProgressJob = Pick<DownloadJob, "url" | "status" | "progress">;

/** mp3server's non-terminal job states; everything else (completed/failed/
 *  canceled/anything future) is terminal — see ALL_STATUSES server-side. */
const ACTIVE_STATUSES = new Set(["queued", "running"]);

/** Consecutive polls finding no active download that are tolerated before the
 *  loop goes idle. A queued track's download job is registered a beat after
 *  the queue itself changes — the client mints a stream URL first and only
 *  requests a download if that misses — so stopping on the first empty poll
 *  would miss every download. */
export const EMPTY_POLL_LIMIT = 6;

/**
 * Whether the download poll should run again, given how many polls in a row
 * have found nothing to show. Bounded so an idle room stops polling instead of
 * asking the audio server about a queue that is fully downloaded forever.
 */
export function shouldPollAgain(consecutiveEmptyPolls: number): boolean {
  return consecutiveEmptyPolls < EMPTY_POLL_LIMIT;
}

/**
 * Percent-complete per videoId for downloads still in flight. Terminal jobs
 * (completed/failed/canceled) are omitted entirely — a finished download must
 * not keep a bar on screen. When several jobs exist for one video the newest
 * wins (the list arrives newest-first): its status alone decides whether that
 * video has a bar, even if an older job for the same video is still active.
 */
export function activeDownloadProgress(
  jobs: readonly DownloadProgressJob[],
): Map<string, number> {
  const progress = new Map<string, number>();
  const decided = new Set<string>();

  for (const job of jobs) {
    const videoId = parseVideoId(job.url);
    if (videoId === null || decided.has(videoId)) continue;
    decided.add(videoId);

    if (!ACTIVE_STATUSES.has(job.status)) continue;
    progress.set(videoId, Math.min(100, Math.max(0, job.progress)));
  }

  return progress;
}
