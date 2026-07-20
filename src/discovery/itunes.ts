import { parseItunesSearchResponse } from "./schema";

const DEFAULT_BASE_URL = "https://itunes.apple.com/search";
const DEFAULT_LIMIT = 10;

/** A normalized music search result, ready to be resolved to a YouTube video. */
export interface MusicCandidate {
  title: string;
  artist: string;
  artworkUrl?: string;
  durationMs?: number;
  source: "itunes";
  sourceId: string;
}

/** The one bit of `fetch` we use — injectable so tests need no network. */
export type FetchLike = (input: URL) => Promise<Response>;

export interface SearchMusicOptions {
  limit?: number;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
  /** Overridable base URL (tests, or a proxy). */
  baseUrl?: string;
}

/**
 * Search Apple's free iTunes Search API for songs matching `query`. Costs zero
 * YouTube quota — used for type-ahead; the chosen candidate is resolved to a
 * YouTube videoId elsewhere. Returns normalized candidates in relevance order,
 * dropping any row without a title or artist.
 */
export async function searchMusic(
  query: string,
  opts: SearchMusicOptions = {},
): Promise<MusicCandidate[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = opts.fetch ?? ((url) => fetch(url));

  const url = new URL(baseUrl);
  url.searchParams.set("term", query);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(opts.limit ?? DEFAULT_LIMIT));

  const response = await doFetch(url);
  if (!response.ok) {
    throw new Error(
      `iTunes Search API ${response.status}: ${response.statusText || "request failed"}`,
    );
  }

  const { results } = parseItunesSearchResponse(await response.json());

  const candidates: MusicCandidate[] = [];
  for (const result of results) {
    if (!result.trackName || !result.artistName) continue;
    const candidate: MusicCandidate = {
      title: result.trackName,
      artist: result.artistName,
      source: "itunes",
      sourceId: String(result.trackId),
    };
    if (result.artworkUrl100 !== undefined) candidate.artworkUrl = result.artworkUrl100;
    if (result.trackTimeMillis !== undefined) candidate.durationMs = result.trackTimeMillis;
    candidates.push(candidate);
  }
  return candidates;
}
