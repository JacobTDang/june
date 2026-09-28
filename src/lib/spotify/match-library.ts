import type { ImportService } from "../../audio/imports";
import {
  importBatch,
  MATCH_BATCH_LIMIT,
  updatesFromImport,
  type MatchingSong,
  type PendingSong,
  type SongMatchUpdate,
} from "./match-plan";

/**
 * One matching step, run at the end of every sync: collect the results of
 * imports already submitted, then submit the next batch of pending songs.
 * Written against two interfaces so it's tested with fakes; the Supabase
 * store is ./match-store.ts.
 */

export interface MatchStore {
  /** Pending songs, oldest first. */
  pendingSongs(limit: number): Promise<PendingSong[]>;
  /** Songs waiting on an import, grouped by the import's id. */
  songsAwaitingImports(): Promise<Map<string, MatchingSong[]>>;
  /** Mark songs as waiting on an import; each one's index is its position. */
  markMatching(jobId: string, songIds: string[]): Promise<void>;
  applyUpdates(updates: SongMatchUpdate[]): Promise<void>;
}

export interface MatchRunResult {
  /** Songs whose import answered: matched, not found, failed or back to pending. */
  collected: number;
  /** Songs submitted in this run's new import. */
  submitted: number;
}

export async function matchLibrary(store: MatchStore, service: ImportService): Promise<MatchRunResult> {
  // Collecting first means a song sent back to pending (its import was
  // cancelled or pruned) goes out again in this same run.
  let collected = 0;
  for (const [jobId, songs] of await store.songsAwaitingImports()) {
    const updates = updatesFromImport(songs, await service.getImport(jobId));
    await store.applyUpdates(updates);
    collected += updates.length;
  }

  const pending = await store.pendingSongs(MATCH_BATCH_LIMIT);
  if (pending.length === 0) return { collected, submitted: 0 };
  const created = await service.createImport(importBatch(pending));
  await store.markMatching(
    created.id,
    pending.map((song) => song.id),
  );
  return { collected, submitted: pending.length };
}
