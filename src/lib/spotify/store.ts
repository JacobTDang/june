import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { LibraryStore } from "./sync-user";

/** Rows per request. Keeps each PostgREST call well under its size limits. */
const BATCH = 500;
/** Supabase's API returns at most this many rows per select. */
const MAX_ROWS = 1000;

function batches<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Supabase returns errors instead of throwing; this makes every write fail loud. */
export function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** The library sync's writes, with the service role: users can read these
 *  tables but never write them, so a library can't be forged. */
export function supabaseLibraryStore(db: SupabaseClient = createServiceClient()): LibraryStore {
  return {
    async upsertSongs(rows) {
      const ids = new Map<string, string>();
      for (const batch of batches(rows)) {
        const { data, error } = await db
          .from("songs")
          .upsert(batch, { onConflict: "source,source_id" })
          .select("id, source_id");
        check("upsert songs", error);
        for (const row of (data ?? []) as { id: string; source_id: string }[]) {
          ids.set(row.source_id, row.id);
        }
      }
      return ids;
    },

    async addListens(userId, listens) {
      for (const batch of batches(listens)) {
        const { error } = await db.from("listens").upsert(
          batch.map((l) => ({ user_id: userId, song_id: l.songId, source: "spotify", played_at: l.playedAt })),
          { onConflict: "user_id,source,played_at", ignoreDuplicates: true },
        );
        check("insert listens", error);
      }
    },

    async newestLikeAt(userId) {
      const { data, error } = await db
        .from("library_songs")
        .select("added_at")
        .eq("user_id", userId)
        .eq("source", "spotify")
        .order("added_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      check("read newest like", error);
      return (data as { added_at: string } | null)?.added_at ?? null;
    },

    async addLikes(userId, likes) {
      for (const batch of batches(likes)) {
        const { error } = await db.from("library_songs").upsert(
          batch.map((l) => ({ user_id: userId, song_id: l.songId, source: "spotify", added_at: l.addedAt })),
          { onConflict: "user_id,source,song_id", ignoreDuplicates: true },
        );
        check("insert likes", error);
      }
    },

    async likedSongIds(userId) {
      const ids: string[] = [];
      for (let from = 0; ; from += MAX_ROWS) {
        const { data, error } = await db
          .from("library_songs")
          .select("song_id")
          .eq("user_id", userId)
          .eq("source", "spotify")
          .order("song_id")
          .range(from, from + MAX_ROWS - 1);
        check("read liked song ids", error);
        const rows = (data ?? []) as { song_id: string }[];
        ids.push(...rows.map((r) => r.song_id));
        if (rows.length < MAX_ROWS) return ids;
      }
    },

    async removeLikes(userId, songIds) {
      for (const batch of batches(songIds, 100)) {
        const { error } = await db
          .from("library_songs")
          .delete()
          .eq("user_id", userId)
          .eq("source", "spotify")
          .in("song_id", batch);
        check("remove unliked songs", error);
      }
    },

    async storedPlaylists(userId) {
      const { data, error } = await db
        .from("playlists")
        .select("source_id, snapshot_id")
        .eq("user_id", userId)
        .eq("source", "spotify");
      check("read playlists", error);
      return ((data ?? []) as { source_id: string; snapshot_id: string | null }[]).map((p) => ({
        sourceId: p.source_id,
        snapshotId: p.snapshot_id,
      }));
    },

    async upsertPlaylists(userId, playlists) {
      const ids = new Map<string, string>();
      for (const batch of batches(playlists)) {
        // snapshot_id and song_count are left out: only replace_playlist_songs
        // sets them, once the songs are actually in.
        const { data, error } = await db
          .from("playlists")
          .upsert(
            batch.map((p) => ({ user_id: userId, ...p })),
            { onConflict: "user_id,source,source_id" },
          )
          .select("id, source_id");
        check("upsert playlists", error);
        for (const row of (data ?? []) as { id: string; source_id: string }[]) {
          ids.set(row.source_id, row.id);
        }
      }
      return ids;
    },

    async replacePlaylistSongs(playlistId, songs, snapshotId) {
      const { error } = await db.rpc("replace_playlist_songs", {
        p_playlist: playlistId,
        p_snapshot: snapshotId,
        p_song_ids: songs.map((s) => s.songId),
        p_added_at: songs.map((s) => s.addedAt),
      });
      check("replace playlist songs", error);
    },

    async removePlaylists(userId, sourceIds) {
      for (const batch of batches(sourceIds, 100)) {
        const { error } = await db
          .from("playlists")
          .delete()
          .eq("user_id", userId)
          .eq("source", "spotify")
          .in("source_id", batch);
        check("remove playlists", error);
      }
    },

    async saveTaste(userId, snapshot) {
      const { error } = await db.from("taste_snapshots").upsert(
        {
          user_id: userId,
          source: "spotify",
          kind: snapshot.kind,
          time_range: snapshot.range,
          items: snapshot.items,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "user_id,source,kind,time_range" },
      );
      check("save taste snapshot", error);
    },
  };
}
