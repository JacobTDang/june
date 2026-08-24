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

/** Only the fields the per-track state reads. Same narrowing rationale as
 *  `DownloadProgressJob`, plus the failure text. */
export type DownloadStateJob = Pick<DownloadJob, "url" | "status" | "progress" | "error">;

/** What the room should say about one track's download right now. */
export type TrackDownloadState =
  | { kind: "idle" }
  | { kind: "active"; percent: number }
  | { kind: "failed"; reason: string };

/** Raw server error text → one line a listener can act on.
 *
 *  mp3server reports yt-dlp's own message, which reads like
 *  "Sign in to confirm you're not a bot. Use --cookies-from-browser …" —
 *  instructions for a program the listener has never run, on a server they
 *  cannot reach. Everything here maps to what it means for *this room*.
 */
export function describeDownloadFailure(error: string | null | undefined): string {
  const lowered = (error ?? "").toLowerCase();
  if (lowered === "") return "The download failed";
  // Checked before the unavailable markers: the bot challenge and the
  // age-restriction notice both start "Sign in to confirm…".
  if (lowered.includes("not a bot")) return "YouTube blocked this download";
  if (
    [
      "video unavailable",
      "private video",
      "has been removed",
      "not available in your country",
      "members-only",
      "age-restricted",
      "copyright",
    ].some((marker) => lowered.includes(marker))
  ) {
    return "This video isn’t available";
  }
  if (lowered.includes("too long")) return "This track is too long";
  if (lowered.includes("insufficient disk space")) return "The audio server is out of space";
  return "The download failed";
}

/**
 * The download state of one specific track.
 *
 * Unlike `activeDownloadProgress`, this does NOT drop terminal jobs: a failure
 * has to reach the listener. Without it a job that died in a second is
 * indistinguishable from one still working, and the room shows "Preparing…"
 * until the 90s liveness timeout gives up — which is exactly how an evening of
 * YouTube bot-blocking looked like a mysteriously stuck player.
 *
 * `jobs` arrives newest-first, and the newest job for the video decides: a
 * retry after a failure must show the retry, not the corpse.
 */
export function trackDownloadState(
  jobs: readonly DownloadStateJob[],
  videoId: string,
): TrackDownloadState {
  const job = jobs.find((candidate) => parseVideoId(candidate.url) === videoId);
  if (job === undefined) return { kind: "idle" };
  if (ACTIVE_STATUSES.has(job.status)) {
    return { kind: "active", percent: Math.min(100, Math.max(0, job.progress)) };
  }
  if (job.status === "failed") {
    return { kind: "failed", reason: describeDownloadFailure(job.error) };
  }
  return { kind: "idle" };
}
