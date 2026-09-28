import "server-only";
import { createImportService } from "../../audio/imports";
import { createSpotifyClient } from "../../spotify/client";
import { previousSyncCutOff } from "../../spotify/diff";
import { classifySyncError, type SyncFailure } from "../../spotify/errors";
import {
  activeConnections,
  claimSyncLease,
  freshAccessToken,
  markAttempt,
  recordFailure,
  recordSuccess,
  releaseSyncLease,
  saveDailyPass,
  saveListenCursor,
  type ConnectionRow,
} from "./connection";
import { mp3serverServiceConfig } from "./config";
import { matchLibrary, type MatchRunResult } from "./match-library";
import { supabaseMatchStore } from "./match-store";
import { supabaseLibraryStore } from "./store";
import { syncUser, type SyncProgress } from "./sync-user";

/** Longer than a first sync of a large library, shorter than the cron gap. */
const LEASE_SECONDS = 300;

/** Vercel stops the function at 300 s, so stop starting new users well before
 *  that, leaving time for the last user plus the lease release. */
const RUN_BUDGET_MS = 200_000;

const CUT_OFF_MESSAGE = "The previous sync was cut off before it finished.";

export type SyncRunResult =
  | { status: "busy" }
  | {
      status: "done";
      synced: number;
      failed: number;
      skipped: number;
      rateLimited: boolean;
      /** Null when matching failed (logged) or ran out of time. */
      matching: MatchRunResult | null;
    };

type UsersResult = Omit<Extract<SyncRunResult, { status: "done" }>, "status" | "matching">;

/** Saves each finished stage of one user's sync on their connection. */
function connectionProgress(userId: string, now: Date): SyncProgress {
  return {
    async listensSaved(recentCursor, gap) {
      if (gap) {
        console.warn(`Spotify listens for ${userId} may be missing plays between ${gap.from} and ${gap.to}.`);
      }
      await saveListenCursor(userId, recentCursor);
    },
    async dailyPassSaved() {
      await saveDailyPass(userId, now);
    },
  };
}

/** Sync one connection. A failure is recorded on the connection (where
 *  /library shows it) and logged; the caller only needs its kind. A previous
 *  run that was killed part way through recorded nothing, so that is recorded
 *  here first; a success now clears it, another kill leaves it showing. */
async function syncConnection(row: ConnectionRow, now: Date): Promise<SyncFailure | null> {
  try {
    const lastAttempt = row.last_attempt_at;
    if (lastAttempt !== null && previousSyncCutOff(lastAttempt, row.last_synced_at, row.last_error_at)) {
      console.error(`Spotify sync for ${row.user_id} that started ${lastAttempt} was cut off before it finished.`);
      // Dated when the cut-off run started, so the attempt marked below is
      // newer than it and a second cut-off in a row is caught as well.
      await recordFailure(row.user_id, { kind: "failed", message: CUT_OFF_MESSAGE }, new Date(lastAttempt));
    }
    await markAttempt(row.user_id, now);
    const accessToken = await freshAccessToken(row, now);
    const outcome = await syncUser(
      {
        userId: row.user_id,
        spotifyUserId: row.spotify_user_id,
        recentCursor: row.recent_cursor,
        lastDailySyncAt: row.last_daily_sync_at,
      },
      createSpotifyClient({ accessToken }),
      supabaseLibraryStore(),
      connectionProgress(row.user_id, now),
      now,
    );
    await recordSuccess(row.user_id, outcome, now);
    return null;
  } catch (err) {
    const failure = classifySyncError(err);
    console.error(`Spotify sync failed for ${row.user_id} (${failure.kind}):`, err);
    await recordFailure(row.user_id, failure, now);
    return failure;
  }
}

/** Match songs to videos on mp3server. Its failure never fails the run: the
 *  Spotify data is already saved, and pending songs wait for the next run. */
async function matchSongs(): Promise<MatchRunResult | null> {
  try {
    return await matchLibrary(supabaseMatchStore(), createImportService(mp3serverServiceConfig()));
  } catch (err) {
    console.error("Library matching failed; songs stay pending for the next run:", err);
    return null;
  }
}

/** Sync each user in turn until the budget runs out or Spotify says stop. */
async function syncUsers(queue: ConnectionRow[], started: number): Promise<UsersResult> {
  let synced = 0;
  let failed = 0;
  for (const [index, row] of queue.entries()) {
    if (Date.now() - started >= RUN_BUDGET_MS) {
      const skipped = queue.slice(index).map((r) => r.user_id);
      console.error(
        `Spotify sync ran out of time and skipped ${skipped.length} users, who go first next run: ${skipped.join(", ")}`,
      );
      return { synced, failed, skipped: skipped.length, rateLimited: false };
    }
    const failure = await syncConnection(row, new Date());
    if (failure === null) {
      synced++;
      continue;
    }
    failed++;
    // Quota is shared across the developer account: carrying on would only
    // spend the next user's calls on the same 429.
    if (failure.kind === "rate-limited") {
      return { synced, failed, skipped: queue.length - index - 1, rateLimited: true };
    }
  }
  return { synced, failed, skipped: 0, rateLimited: false };
}

async function run(rows: () => Promise<ConnectionRow[]>): Promise<SyncRunResult> {
  const started = Date.now();
  const holder = await claimSyncLease(LEASE_SECONDS);
  if (holder === null) return { status: "busy" };
  try {
    const users = await syncUsers(await rows(), started);
    // Matching talks to mp3server, not Spotify, so a 429 doesn't stop it; only
    // the time budget does.
    let matching: MatchRunResult | null = null;
    if (Date.now() - started < RUN_BUDGET_MS) {
      matching = await matchSongs();
    } else {
      console.warn("Spotify sync skipped library matching: out of time.");
    }
    return { status: "done", ...users, matching };
  } finally {
    await releaseSyncLease(holder);
  }
}

/** Every active connection, one at a time. The cron entry point. */
export function syncAllUsers(): Promise<SyncRunResult> {
  return run(() => activeConnections());
}

/** One user, for their first sync and for Sync now. */
export function syncOneUser(userId: string): Promise<SyncRunResult> {
  return run(() => activeConnections(userId));
}
