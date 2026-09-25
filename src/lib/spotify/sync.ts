import "server-only";
import { createSpotifyClient } from "../../spotify/client";
import { classifySyncError, type SyncFailure } from "../../spotify/errors";
import {
  activeConnections,
  claimSyncLease,
  freshAccessToken,
  recordFailure,
  recordSuccess,
  releaseSyncLease,
  saveDailyPass,
  saveListenCursor,
  type ConnectionRow,
} from "./connection";
import { supabaseLibraryStore } from "./store";
import { syncUser, type SyncProgress } from "./sync-user";

/** Longer than a first sync of a large library, shorter than the cron gap. */
const LEASE_SECONDS = 300;

export type SyncRunResult =
  | { status: "busy" }
  | { status: "done"; synced: number; failed: number; rateLimited: boolean };

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
 *  /library shows it) and logged; the caller only needs its kind. */
async function syncConnection(row: ConnectionRow, now: Date): Promise<SyncFailure | null> {
  try {
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

async function run(rows: () => Promise<ConnectionRow[]>): Promise<SyncRunResult> {
  const holder = await claimSyncLease(LEASE_SECONDS);
  if (holder === null) return { status: "busy" };
  try {
    let synced = 0;
    let failed = 0;
    for (const row of await rows()) {
      const failure = await syncConnection(row, new Date());
      if (failure === null) {
        synced++;
        continue;
      }
      failed++;
      // Quota is shared across the developer account: carrying on would only
      // spend the next user's calls on the same 429.
      if (failure.kind === "rate-limited") return { status: "done", synced, failed, rateLimited: true };
    }
    return { status: "done", synced, failed, rateLimited: false };
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
