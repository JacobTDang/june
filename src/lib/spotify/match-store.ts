import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { MatchStore } from "./match-library";
import { matchUpdateRow, type MatchingSong } from "./match-plan";
import { check } from "./store";

/** Supabase's API returns at most this many rows per select. */
const MAX_ROWS = 1000;

/** Matching's reads and writes on songs, with the service role: songs are
 *  readable by every signed-in user but written only by the server. */
export function supabaseMatchStore(db: SupabaseClient = createServiceClient()): MatchStore {
  return {
    async pendingSongs(limit) {
      const { data, error } = await db
        .from("songs")
        .select("id, title, artists, duration_ms")
        .eq("match_state", "pending")
        .order("created_at")
        .limit(limit);
      check("read songs to match", error);
      return ((data ?? []) as { id: string; title: string; artists: string[]; duration_ms: number | null }[]).map(
        (s) => ({ id: s.id, title: s.title, artists: s.artists, durationMs: s.duration_ms }),
      );
    },

    async songsAwaitingImports() {
      const byJob = new Map<string, MatchingSong[]>();
      for (let from = 0; ; from += MAX_ROWS) {
        const { data, error } = await db
          .from("songs")
          .select("id, match_job_id, match_position")
          .eq("match_state", "matching")
          .order("id")
          .range(from, from + MAX_ROWS - 1);
        check("read songs being matched", error);
        const rows = (data ?? []) as { id: string; match_job_id: string | null; match_position: number | null }[];
        for (const row of rows) {
          if (row.match_job_id === null || row.match_position === null) {
            throw new Error(`song ${row.id} is matching without an import or a position`);
          }
          const songs = byJob.get(row.match_job_id) ?? [];
          songs.push({ id: row.id, position: row.match_position });
          byJob.set(row.match_job_id, songs);
        }
        if (rows.length < MAX_ROWS) return byJob;
      }
    },

    async markMatching(jobId, songIds) {
      const { error } = await db.rpc("mark_songs_matching", { p_job: jobId, p_song_ids: songIds });
      check("mark songs as matching", error);
    },

    async applyUpdates(updates) {
      if (updates.length === 0) return;
      const { error } = await db.rpc("apply_song_matches", { p_updates: updates.map(matchUpdateRow) });
      check("save song matches", error);
    },
  };
}
