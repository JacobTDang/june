import { parseItunesSearchResponse, type ItunesTrack } from "./schema";
import { normalizeQuery } from "./normalize";
import { rankSongResults } from "./rank";

const DEFAULT_BASE_URL = "https://itunes.apple.com/search";
const DEFAULT_LOOKUP_URL = "https://itunes.apple.com/lookup";
const DEFAULT_LIMIT = 15;
const DEFAULT_ARTIST_LIMIT = 5;
const DEFAULT_TOP_SONGS_LIMIT = 12;
/** Below this many hits we retry the raw query, in case normalization over-trimmed. */
const SPARSE_THRESHOLD = 3;

/** A normalized music search result, ready to be resolved to a YouTube video. */
export interface MusicCandidate {
  title: string;
  artist: string;
  artworkUrl?: string;
  durationMs?: number;
  source: "itunes";
  sourceId: string;
}

/**
 * A normalized artist search result. iTunes artist entities carry no artwork,
 * so `artworkUrl` is filled in by the action layer (borrowed from a top song).
 */
export interface ArtistCandidate {
  artistId: string;
  name: string;
  genre?: string;
  artworkUrl?: string;
  source: "itunes";
}

/** The one bit of `fetch` we use - injectable so tests need no network. */
export type FetchLike = (input: URL) => Promise<Response>;

export interface SearchMusicOptions {
  limit?: number;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
  /** Overridable base URL (tests, or a proxy). */
  baseUrl?: string;
}

/** Map one raw iTunes row to a song candidate, or null if it isn't a usable song. */
function toMusicCandidate(row: ItunesTrack): MusicCandidate | null {
  if (row.trackId === undefined || !row.trackName || !row.artistName) return null;
  const candidate: MusicCandidate = {
    title: row.trackName,
    artist: row.artistName,
    source: "itunes",
    sourceId: String(row.trackId),
  };
  if (row.artworkUrl100 !== undefined) candidate.artworkUrl = row.artworkUrl100;
  if (row.trackTimeMillis !== undefined) candidate.durationMs = row.trackTimeMillis;
  return candidate;
}

function throwOnHttpError(response: Response): void {
  if (!response.ok) {
    throw new Error(
      `iTunes Search API ${response.status}: ${response.statusText || "request failed"}`,
    );
  }
}

/** One iTunes song search - parse and normalize, no ranking yet. */
async function fetchSongs(
  term: string,
  limit: number,
  baseUrl: string,
  doFetch: FetchLike,
): Promise<MusicCandidate[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("term", term);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(limit));

  const response = await doFetch(url);
  throwOnHttpError(response);

  const { results } = parseItunesSearchResponse(await response.json());
  const candidates: MusicCandidate[] = [];
  for (const row of results) {
    const candidate = toMusicCandidate(row);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Search Apple's free iTunes Search API for songs matching `query`. Costs zero
 * YouTube quota - used for type-ahead; the chosen candidate is resolved to a
 * YouTube videoId elsewhere.
 *
 * The query is normalized (noise like "official video" stripped) and results
 * are ranked so the studio version outranks karaoke/live/remix cuts. If the
 * normalized search comes back sparse *and* normalization changed the term, we
 * retry once with the raw query so over-trimming can't hide real matches. HTTP
 * errors always throw - the retry is only for the sparse case, never to mask one.
 */
export async function searchMusic(
  query: string,
  opts: SearchMusicOptions = {},
): Promise<MusicCandidate[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = opts.fetch ?? ((url) => fetch(url));
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const normalized = normalizeQuery(query);
  const raw = query.trim();

  let candidates = await fetchSongs(normalized, limit, baseUrl, doFetch);
  if (candidates.length < SPARSE_THRESHOLD && normalized !== raw) {
    const retried = await fetchSongs(raw, limit, baseUrl, doFetch);
    if (retried.length > candidates.length) candidates = retried;
  }

  return rankSongResults(candidates);
}

/**
 * Search iTunes for artists matching `query` (entity=musicArtist). Artist
 * entities carry no artwork, so `artworkUrl` is left undefined here - the action
 * layer borrows a cover from one of the artist's top songs. Drops rows without
 * an artistId or name.
 */
export async function searchArtists(
  query: string,
  opts: SearchMusicOptions = {},
): Promise<ArtistCandidate[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = opts.fetch ?? ((url) => fetch(url));

  const url = new URL(baseUrl);
  url.searchParams.set("term", normalizeQuery(query));
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", "musicArtist");
  url.searchParams.set("limit", String(opts.limit ?? DEFAULT_ARTIST_LIMIT));

  const response = await doFetch(url);
  throwOnHttpError(response);

  const { results } = parseItunesSearchResponse(await response.json());
  const artists: ArtistCandidate[] = [];
  for (const row of results) {
    if (row.artistId === undefined || !row.artistName) continue;
    const artist: ArtistCandidate = {
      artistId: String(row.artistId),
      name: row.artistName,
      source: "itunes",
    };
    if (row.primaryGenreName !== undefined) artist.genre = row.primaryGenreName;
    artists.push(artist);
  }
  return artists;
}

/**
 * Look up an artist's songs by iTunes artistId (lookup?entity=song). The
 * response leads with the artist wrapper row (no trackId) followed by songs;
 * the wrapper is dropped by `toMusicCandidate` and the songs are ranked so the
 * studio versions lead.
 */
export async function getArtistTopSongs(
  artistId: string,
  opts: SearchMusicOptions = {},
): Promise<MusicCandidate[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_LOOKUP_URL;
  const doFetch: FetchLike = opts.fetch ?? ((url) => fetch(url));

  const url = new URL(baseUrl);
  url.searchParams.set("id", artistId);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", String(opts.limit ?? DEFAULT_TOP_SONGS_LIMIT));

  const response = await doFetch(url);
  throwOnHttpError(response);

  const { results } = parseItunesSearchResponse(await response.json());
  const songs: MusicCandidate[] = [];
  for (const row of results) {
    const candidate = toMusicCandidate(row);
    if (candidate) songs.push(candidate);
  }
  return rankSongResults(songs);
}

/**
 * Look up a single iTunes track by id — the canonical title/artist for a
 * sourceId. Used to verify a resolution against the real track rather than a
 * caller-supplied (possibly forged) title. Returns null if the id resolves to
 * no usable track.
 */
export async function getTrackById(
  id: string,
  opts: SearchMusicOptions = {},
): Promise<MusicCandidate | null> {
  const baseUrl = opts.baseUrl ?? DEFAULT_LOOKUP_URL;
  const doFetch: FetchLike = opts.fetch ?? ((url) => fetch(url));

  const url = new URL(baseUrl);
  url.searchParams.set("id", id);

  const response = await doFetch(url);
  throwOnHttpError(response);

  const { results } = parseItunesSearchResponse(await response.json());
  for (const row of results) {
    const candidate = toMusicCandidate(row);
    if (candidate && candidate.sourceId === id) return candidate;
  }
  return null;
}
