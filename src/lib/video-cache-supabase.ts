import type { YouTubeClient } from "../youtube/client";
import { createServiceClient } from "./supabase/service";
import { toVideoMeta, type CacheDeps, type VideoMeta } from "./video-cache";

interface VideoCacheRow {
  video_id: string;
  title: string;
  artist: string | null;
  duration_ms: number;
  thumbnail_url: string | null;
  embeddable: boolean;
}

function rowToMeta(row: VideoCacheRow): VideoMeta {
  return {
    videoId: row.video_id,
    title: row.title,
    artist: row.artist ?? undefined,
    durationMs: row.duration_ms,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    embeddable: row.embeddable,
  };
}

function metaToRow(meta: VideoMeta): VideoCacheRow & { fetched_at: string } {
  return {
    video_id: meta.videoId,
    title: meta.title,
    artist: meta.artist ?? null,
    duration_ms: meta.durationMs,
    thumbnail_url: meta.thumbnailUrl ?? null,
    embeddable: meta.embeddable,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Cache IO backed by the Supabase `video_cache` table, with misses fetched via
 * the YouTube client. Plug this into `getVideoMetas` on the server.
 */
export function supabaseVideoCache(youtube: YouTubeClient): CacheDeps {
  // The video_cache is shared server infrastructure — read and written with the
  // service role so clients can't poison it (writes are RLS-locked).
  const supabase = createServiceClient();
  return {
    async readCache(ids) {
      const { data, error } = await supabase
        .from("video_cache")
        .select("video_id, title, artist, duration_ms, thumbnail_url, embeddable")
        .in("video_id", ids);
      if (error) throw new Error(`video_cache read failed: ${error.message}`);
      return ((data ?? []) as VideoCacheRow[]).map(rowToMeta);
    },
    async writeCache(metas) {
      const { error } = await supabase.from("video_cache").upsert(metas.map(metaToRow));
      if (error) throw new Error(`video_cache write failed: ${error.message}`);
    },
    async fetchFresh(ids) {
      const items = await youtube.getVideos(ids);
      return items.map(toVideoMeta);
    },
  };
}
