import { SpotifyApiError } from "./errors";
import { RECENTLY_PLAYED_LIMIT, SPOTIFY_PAGE_SIZE, type TimeRange } from "./limits";
import {
  meSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  recentlyPlayedSchema,
  savedTracksPageSchema,
  topArtistsSchema,
  topTracksSchema,
  type PlaylistItem,
  type PlaylistSummary,
  type RecentlyPlayedItem,
  type SavedTracksPage,
  type SpotifyMe,
  type SpotifyTrack,
  type TopArtist,
} from "./schema";

const DEFAULT_BASE_URL = "https://api.spotify.com/v1";
/** 20,000 entries. Far past any real playlist; hitting it means paging broke. */
const MAX_PAGES = 400;

/** The slice of the Web API the library sync needs. */
export interface SpotifyClient {
  me(): Promise<SpotifyMe>;
  /** Plays after `afterMs` (exclusive), or the latest 50 when null. */
  recentlyPlayed(afterMs: number | null): Promise<RecentlyPlayedItem[]>;
  /** One page of liked songs, newest first. The caller decides when to stop. */
  savedTracks(offset: number): Promise<SavedTracksPage>;
  /** Every playlist in the user's library, all pages. */
  myPlaylists(): Promise<PlaylistSummary[]>;
  /** Every entry of a playlist the user owns or collaborates on, all pages. */
  playlistItems(playlistId: string): Promise<PlaylistItem[]>;
  topArtists(range: TimeRange): Promise<TopArtist[]>;
  topTracks(range: TimeRange): Promise<SpotifyTrack[]>;
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface SpotifyClientConfig {
  accessToken: string;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
  baseUrl?: string;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    if (body.error && typeof body.error === "object" && body.error.message) return body.error.message;
    return JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function createSpotifyClient(config: SpotifyClientConfig): SpotifyClient {
  if (!config.accessToken) throw new Error("createSpotifyClient: accessToken is required");
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!response.ok) {
      const retry = response.status === 429 ? retryAfterSeconds(response) : null;
      throw new SpotifyApiError(
        response.status,
        `Spotify API ${response.status} on ${path}: ${await errorMessage(response)}`,
        retry,
      );
    }
    return response.json();
  }

  async function allPages<T>(
    path: string,
    parse: (json: unknown) => { items: T[]; next: string | null },
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { items, next } = parse(
        await get(path, { limit: String(SPOTIFY_PAGE_SIZE), offset: String(page * SPOTIFY_PAGE_SIZE) }),
      );
      all.push(...items);
      if (next === null) return all;
    }
    throw new Error(`Spotify API: ${path} was still paging after ${MAX_PAGES} pages`);
  }

  return {
    async me() {
      return meSchema.parse(await get("/me"));
    },

    async recentlyPlayed(afterMs) {
      const params: Record<string, string> = { limit: String(RECENTLY_PLAYED_LIMIT) };
      if (afterMs !== null) params.after = String(afterMs);
      return recentlyPlayedSchema.parse(await get("/me/player/recently-played", params)).items;
    },

    async savedTracks(offset) {
      return savedTracksPageSchema.parse(
        await get("/me/tracks", { limit: String(SPOTIFY_PAGE_SIZE), offset: String(offset) }),
      );
    },

    async myPlaylists() {
      return allPages("/me/playlists", (json) => playlistsPageSchema.parse(json));
    },

    async playlistItems(playlistId) {
      if (!playlistId) throw new Error("playlistItems: playlistId is required");
      return allPages(`/playlists/${encodeURIComponent(playlistId)}/items`, (json) =>
        playlistItemsPageSchema.parse(json),
      );
    },

    async topArtists(range) {
      return topArtistsSchema.parse(
        await get("/me/top/artists", { time_range: range, limit: String(SPOTIFY_PAGE_SIZE) }),
      ).items;
    },

    async topTracks(range) {
      return topTracksSchema.parse(
        await get("/me/top/tracks", { time_range: range, limit: String(SPOTIFY_PAGE_SIZE) }),
      ).items;
    },
  };
}
