import { parseVideoId } from "../youtube/url";

export interface DownloadJob {
  id: string;
  url: string;
  status: string;
  progress: number;
}

/** mp3server's non-terminal job states; everything else (completed/failed/
 *  canceled/anything future) is terminal — see ALL_STATUSES server-side. */
const ACTIVE_STATUSES = new Set(["queued", "running"]);

/**
 * Percent-complete per videoId for downloads still in flight. Terminal jobs
 * (completed/failed/canceled) are omitted entirely — a finished download must
 * not keep a bar on screen. When several jobs exist for one video the newest
 * wins (the list arrives newest-first): its status alone decides whether that
 * video has a bar, even if an older job for the same video is still active.
 */
export function activeDownloadProgress(jobs: readonly DownloadJob[]): Map<string, number> {
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
