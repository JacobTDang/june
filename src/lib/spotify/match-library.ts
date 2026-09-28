import type { ImportService } from "../../audio/imports";
import {
  FAILED_RETRY_AFTER_MS,
  importBatch,
  MATCH_BATCH_LIMIT,
  updatesFromImport,
  type MatchingSong,
  type PendingSong,
  type SongMatchUpdate,
} from "./match-plan";

/**
 * One matching step, run at the end of every sync: put songs that failed a
 * day ago back in line, collect the results of imports already submitted,
 * then submit the next batch of pending songs.
 * Written against two interfaces so it's tested with fakes; the Supabase
 * store is ./match-store.ts.
 */

export interface MatchStore {
  /** Send failed songs whose last attempt is older than this back to pending.
   *  Returns how many. */
  requeueFailed(olderThan: Date): Promise<number>;
  /** Pending songs, oldest first. */
  pendingSongs(limit: number): Promise<PendingSong[]>;
  /** Songs waiting on an import, grouped by the import's id. */
  songsAwaitingImports(): Promise<Map<string, MatchingSong[]>>;
  /** Mark songs as waiting on an import; each one's index is its position. */
  markMatching(jobId: string, songIds: string[]): Promise<void>;
  applyUpdates(updates: SongMatchUpdate[]): Promise<void>;
}

export interface MatchRunResult {
  /** Failed songs put back in line. */
  requeued: number;
  /** Songs whose import answered: matched, not found, failed or back to pending. */
  collected: number;
  /** Songs submitted in this run's new import. */
  submitted: number;
}

export async function matchLibrary(store: MatchStore, service: ImportService, now: Date): Promise<MatchRunResult> {
  // Before reading pending songs, so the requeued ones go out in this run:
  // mark_songs_matching only marks songs that are still pending.
  const requeued = await store.requeueFailed(new Date(now.getTime() - FAILED_RETRY_AFTER_MS));

  // Collecting first means a song sent back to pending (its import was
  // cancelled or pruned) goes out again in this same run.
  let collected = 0;
  for (const [jobId, songs] of await store.songsAwaitingImports()) {
    const updates = updatesFromImport(songs, await service.getImport(jobId));
    await store.applyUpdates(updates);
    collected += updates.length;
  }

  const pending = await store.pendingSongs(MATCH_BATCH_LIMIT);
  if (pending.length === 0) return { requeued, collected, submitted: 0 };
  const created = await service.createImport(importBatch(pending));
  await store.markMatching(
    created.id,
    pending.map((song) => song.id),
  );
  return { requeued, collected, submitted: pending.length };
}
