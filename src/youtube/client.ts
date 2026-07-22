import { toPlaylist, type Playlist } from "./playlist";
import {
  parsePlaylistItemsResponse,
  parsePlaylistsResponse,
  parseSearchListResponse,
  parseVideoListResponse,
  type YouTubeVideoItem,
} from "./schema";
import { videosToTracks, type VideoConversion } from "./track";

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";
/** `videos.list` accepts at most 50 ids per request. */
const MAX_IDS_PER_CALL = 50;
/** `list` endpoints return at most 50 items per page. */
const MAX_PAGE_SIZE = 50;

/** The slice of the YouTube Data API the jam needs. */
export interface YouTubeClient {
  /** Search for videos matching `query`, returning their ids in relevance order. */
  searchVideoIds(query: string, opts?: { maxResults?: number }): Promise<string[]>;
  /** Fetch full details for the given video ids (deduped, in the order given). */
  getVideos(ids: string[]): Promise<YouTubeVideoItem[]>;
  /** The signed-in user's own playlists (requires an OAuth access token). */
  listPlaylists(): Promise<Playlist[]>;
  /** Every video id in a playlist, in playlist order (requires an OAuth access token). */
  listPlaylistVideoIds(playlistId: string): Promise<string[]>;
}

/** The one bit of `fetch` we use - injectable so tests need no network. */
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface YouTubeClientConfig {
  /** App API key, used for public reads (search, video details). */
  apiKey: string;
  /** OAuth access token for the signed-in user's private data (their playlists). */
  accessToken?: string;
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

/** Follow `nextPageToken` until exhausted, guarding against a non-terminating API. */
async function paginate<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken?: string }>,
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await fetchPage(pageToken);
    all.push(...page.items);
    pageToken = page.nextPageToken;
    if (pageToken !== undefined) {
      if (seen.has(pageToken)) {
        throw new Error("YouTube API: pagination did not terminate (repeated page token)");
      }
      seen.add(pageToken);
    }
  } while (pageToken !== undefined);
  return all;
}

export function createYouTubeClient(config: YouTubeClientConfig): YouTubeClient {
  const { apiKey, accessToken } = config;
  if (!apiKey) throw new Error("createYouTubeClient: apiKey is required");
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  async function get(
    path: string,
    params: Record<string, string>,
    requireAuth = false,
  ): Promise<unknown> {
    if (requireAuth && accessToken === undefined) {
      throw new Error(
        `YouTube API: "${path}" requires an OAuth access token (user not signed in)`,
      );
    }

    const url = new URL(`${baseUrl}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("key", apiKey);

    const headers: Record<string, string> = {};
    if (accessToken !== undefined) headers.Authorization = `Bearer ${accessToken}`;

    const response = await doFetch(url, { headers });
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

    async listPlaylists() {
      const items = await paginate(async (pageToken) => {
        const params: Record<string, string> = {
          part: "snippet,contentDetails",
          mine: "true",
          maxResults: String(MAX_PAGE_SIZE),
        };
        if (pageToken !== undefined) params.pageToken = pageToken;
        return parsePlaylistsResponse(await get("playlists", params, true));
      });
      return items.map(toPlaylist);
    },

    async listPlaylistVideoIds(playlistId) {
      if (!playlistId) throw new Error("listPlaylistVideoIds: playlistId is required");
      const items = await paginate(async (pageToken) => {
        const params: Record<string, string> = {
          part: "contentDetails",
          playlistId,
          maxResults: String(MAX_PAGE_SIZE),
        };
        if (pageToken !== undefined) params.pageToken = pageToken;
        return parsePlaylistItemsResponse(await get("playlistItems", params, true));
      });
      return items.map((item) => item.contentDetails.videoId);
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

/**
 * Import a whole playlist as jam tracks: it reads the playlist's video ids,
 * fetches their details, and returns the playable tracks plus anything skipped.
 */
export async function importPlaylist(
  client: YouTubeClient,
  playlistId: string,
  addedBy: string,
  opts?: { makeId?: () => string },
): Promise<VideoConversion> {
  const ids = await client.listPlaylistVideoIds(playlistId);
  const videos = await client.getVideos(ids);
  return videosToTracks(videos, addedBy, opts?.makeId);
}
