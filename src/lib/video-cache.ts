import { parseIso8601Duration } from "../youtube/duration";
import type { YouTubeVideoItem } from "../youtube/schema";
import { pickThumbnail } from "../youtube/track";

/** Playable metadata for one YouTube video — the shape we cache and reuse. */
export interface VideoMeta {
  videoId: string;
  title: string;
  artist?: string;
  durationMs: number;
  thumbnailUrl?: string;
  embeddable: boolean;
}

/** Convert a raw `videos.list` item into cacheable metadata. */
export function toVideoMeta(item: YouTubeVideoItem): VideoMeta {
  return {
    videoId: item.id,
    title: item.snippet.title,
    artist: item.snippet.channelTitle,
    durationMs: parseIso8601Duration(item.contentDetails.duration),
    thumbnailUrl: pickThumbnail(item.snippet.thumbnails),
    embeddable: item.status?.embeddable ?? true,
  };
}

/** The IO the cache orchestration needs — injected so the logic stays pure. */
export interface CacheDeps {
  /** Return whatever metadata is already cached for these ids (a subset). */
  readCache(ids: string[]): Promise<VideoMeta[]>;
  /** Persist freshly fetched metadata. */
  writeCache(metas: VideoMeta[]): Promise<void>;
  /** Fetch metadata for cache misses (e.g. YouTube `videos.list`). */
  fetchFresh(ids: string[]): Promise<VideoMeta[]>;
}

/**
 * Return metadata for `ids`, reading from cache and only fetching (then caching)
 * the misses. Result order follows `ids`; ids that resolve to nothing are
 * dropped. This is what turns repeat/overlapping imports into ~free operations.
 */
export async function getVideoMetas(
  ids: string[],
  deps: CacheDeps,
): Promise<VideoMeta[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const cached = await deps.readCache(unique);
  const byId = new Map(cached.map((m) => [m.videoId, m]));
  const missing = unique.filter((id) => !byId.has(id));

  if (missing.length > 0) {
    const fresh = await deps.fetchFresh(missing);
    if (fresh.length > 0) await deps.writeCache(fresh);
    for (const meta of fresh) byId.set(meta.videoId, meta);
  }

  return unique
    .map((id) => byId.get(id))
    .filter((meta): meta is VideoMeta => meta !== undefined);
}
