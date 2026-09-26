import { RECENTLY_PLAYED_LIMIT } from "./limits";
import type { PlaylistSummary } from "./schema";

/**
 * Liked songs arrive newest first. Everything at or after the newest like
 * already stored is kept; the first one strictly older means the rest are
 * stored too. Equal timestamps are kept rather than skipped (the upsert
 * ignores duplicates), so two likes in the same second can't hide each other.
 */
export function freshLikes<T extends { added_at: string }>(
  items: readonly T[],
  newestKnown: string | null,
): { fresh: T[]; done: boolean } {
  if (newestKnown === null) return { fresh: [...items], done: false };
  const cutoff = Date.parse(newestKnown);
  const fresh: T[] = [];
  for (const item of items) {
    if (Date.parse(item.added_at) < cutoff) return { fresh, done: true };
    fresh.push(item);
  }
  return { fresh, done: false };
}

/** Stored likes the daily full pass didn't see: the user unliked them. */
export function likesToRemove(stored: readonly string[], seen: ReadonlySet<string>): string[] {
  return stored.filter((songId) => !seen.has(songId));
}

export interface StoredPlaylist {
  sourceId: string;
  snapshotId: string | null;
}

/**
 * Which playlists to keep, re-read and forget. Only owned and collaborative
 * playlists count: Development Mode returns no songs for anyone else's. A
 * playlist is re-read when its snapshot differs from the one stored, which
 * includes one whose songs were never finished (stored snapshot null).
 */
export function planPlaylists(
  remote: readonly PlaylistSummary[],
  stored: readonly StoredPlaylist[],
  spotifyUserId: string,
): { mine: PlaylistSummary[]; refresh: PlaylistSummary[]; remove: string[] } {
  const mine = remote.filter((p) => p.owner.id === spotifyUserId || p.collaborative);
  const storedSnapshots = new Map(stored.map((p) => [p.sourceId, p.snapshotId]));
  const refresh = mine.filter((p) => storedSnapshots.get(p.id) !== p.snapshot_id);
  const keep = new Set(mine.map((p) => p.id));
  const remove = stored.filter((p) => !keep.has(p.sourceId)).map((p) => p.sourceId);
  return { mine, refresh, remove };
}

/** The newest play seen so far. Never moves backwards. */
export function advanceCursor(playedAt: readonly string[], previous: string | null): string | null {
  let newest = previous === null ? null : Date.parse(previous);
  for (const at of playedAt) {
    const time = Date.parse(at);
    if (newest === null || time > newest) newest = time;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * Spotify keeps only the last 50 plays. A full page whose oldest play is
 * still newer than the cursor means plays in between were lost; this names
 * the window so the run can log it.
 */
export function recentGap(
  playedAt: readonly string[],
  previous: string | null,
): { from: string; to: string } | null {
  if (previous === null || playedAt.length < RECENTLY_PLAYED_LIMIT) return null;
  const oldest = Math.min(...playedAt.map((at) => Date.parse(at)));
  if (oldest <= Date.parse(previous)) return null;
  return { from: previous, to: new Date(oldest).toISOString() };
}

export function tokenNeedsRefresh(
  expiresAt: string | null,
  now: Date,
  marginMs = 60_000,
): boolean {
  if (expiresAt === null) return true;
  return Date.parse(expiresAt) - now.getTime() <= marginMs;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily pass re-reads every like (to catch unlikes) and the top lists. */
export function dailyPassDue(lastDaily: string | null, now: Date): boolean {
  return lastDaily === null || now.getTime() - Date.parse(lastDaily) >= DAY_MS;
}

/** Sync now waits a minute after the last attempt, whether it worked or not. */
export function syncNowAllowed(
  lastAttemptAt: string | null,
  now: Date,
  minIntervalMs = 60_000,
): boolean {
  return lastAttemptAt === null || now.getTime() - Date.parse(lastAttemptAt) >= minIntervalMs;
}

/**
 * A run marks its attempt before syncing a user and records a success or an
 * error after. An attempt newer than both means the run stopped in between
 * without recording anything, most likely killed by the function time limit.
 * A null time means it never happened.
 */
export function previousSyncCutOff(
  lastAttemptAt: string | null,
  lastSyncedAt: string | null,
  lastErrorAt: string | null,
): boolean {
  if (lastAttemptAt === null) return false;
  const attempt = Date.parse(lastAttemptAt);
  const isOlder = (at: string | null) => at === null || Date.parse(at) < attempt;
  return isOlder(lastSyncedAt) && isOlder(lastErrorAt);
}
