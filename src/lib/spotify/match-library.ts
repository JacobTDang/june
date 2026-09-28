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
  /** Imports that couldn't be read or saved this run (logged); their songs
   *  stay matching and are collected next run. */
  collectErrors: number;
  /** Songs submitted in this run's new import. */
  submitted: number;
  /** Pending songs with a blank title or artist, marked failed instead. */
  unsendable: number;
}

export async function matchLibrary(store: MatchStore, service: ImportService, now: Date): Promise<MatchRunResult> {
  // Before reading pending songs, so the requeued ones go out in this run:
  // mark_songs_matching only marks songs that are still pending.
  const requeued = await store.requeueFailed(new Date(now.getTime() - FAILED_RETRY_AFTER_MS));

  // Collecting first means a song sent back to pending (its import was
  // cancelled or pruned) goes out again in this same run.
  let collected = 0;
  let collectErrors = 0;
  for (const [jobId, songs] of await store.songsAwaitingImports()) {
    // One import that can't be read or saved must not hold up the others or
    // the next batch. Its songs stay matching and are tried again next run.
    try {
      const updates = updatesFromImport(songs, await service.getImport(jobId));
      await store.applyUpdates(updates);
      collected += updates.length;
    } catch (err) {
      collectErrors++;
      console.error(`Collecting import ${jobId} (${songs.length} songs) failed; they stay matching:`, err);
    }
  }

  const batch = importBatch(await store.pendingSongs(MATCH_BATCH_LIMIT));
  if (batch.unsendable.length > 0) {
    for (const songId of batch.unsendable) {
      console.error(`Song ${songId} can't be matched: its title or artist is blank. Marking it failed.`);
    }
    await store.applyUpdates(batch.unsendable.map((songId) => ({ songId, state: "failed" as const })));
  }
  const result = { requeued, collected, collectErrors, submitted: 0, unsendable: batch.unsendable.length };
  if (batch.tracks.length === 0) return result;

  const created = await service.createImport(batch.tracks);
  await store.markMatching(created.id, batch.sendable);
  return { ...result, submitted: batch.tracks.length };
}
