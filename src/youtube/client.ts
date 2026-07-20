import {
  parseSearchListResponse,
  parseVideoListResponse,
  type YouTubeVideoItem,
} from "./schema";
import { videosToTracks, type VideoConversion } from "./track";

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";
/** `videos.list` accepts at most 50 ids per request. */
const MAX_IDS_PER_CALL = 50;

/** The slice of the YouTube Data API the jam needs. */
export interface YouTubeClient {
  /** Search for videos matching `query`, returning their ids in relevance order. */
  searchVideoIds(query: string, opts?: { maxResults?: number }): Promise<string[]>;
  /** Fetch full details for the given video ids (deduped, in the order given). */
  getVideos(ids: string[]): Promise<YouTubeVideoItem[]>;
}

/** The one bit of `fetch` we use — injectable so tests need no network. */
type FetchLike = (input: URL) => Promise<Response>;

export interface YouTubeClientConfig {
  apiKey: string;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
  /** Overridable base URL (tests, or a proxy). */
  baseUrl?: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

export function createYouTubeClient(config: YouTubeClientConfig): YouTubeClient {
  const { apiKey } = config;
  if (!apiKey) throw new Error("createYouTubeClient: apiKey is required");
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = config.fetch ?? ((url) => fetch(url));

  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${baseUrl}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("key", apiKey);

    const response = await doFetch(url);
    if (!response.ok) {
      throw new Error(`YouTube API ${response.status}: ${await errorDetail(response)}`);
    }
    return response.json();
  }

  return {
    async searchVideoIds(query, opts) {
      const json = await get("search", {
        part: "snippet",
        type: "video",
        q: query,
        maxResults: String(opts?.maxResults ?? 25),
      });
      return parseSearchListResponse(json)
        .items.map((item) => item.id.videoId)
        .filter((id): id is string => id !== undefined);
    },

    async getVideos(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return [];

      const items: YouTubeVideoItem[] = [];
      for (const batch of chunk(unique, MAX_IDS_PER_CALL)) {
        const json = await get("videos", {
          part: "snippet,contentDetails,status",
          id: batch.join(","),
        });
        items.push(...parseVideoListResponse(json).items);
      }

      // Preserve the requested order; drop ids YouTube returned nothing for
      // (deleted, private, region-blocked).
      const byId = new Map(items.map((item) => [item.id, item]));
      return unique
        .map((id) => byId.get(id))
        .filter((item): item is YouTubeVideoItem => item !== undefined);
    },
  };
}

/**
 * Search YouTube and convert the results into jam tracks in one call: it runs
 * the search, fetches details for the hits, and returns the playable tracks
 * plus anything skipped (with a reason). `makeId` is injectable for tests.
 */
export async function searchTracks(
  client: YouTubeClient,
  query: string,
  addedBy: string,
  opts?: { maxResults?: number; makeId?: () => string },
): Promise<VideoConversion> {
  const ids = await client.searchVideoIds(query, { maxResults: opts?.maxResults });
  const videos = await client.getVideos(ids);
  return videosToTracks(videos, addedBy, opts?.makeId);
}
