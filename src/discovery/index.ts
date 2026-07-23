export { searchMusic, searchArtists, getArtistTopSongs, getTrackById } from "./itunes";
export type { MusicCandidate, ArtistCandidate, SearchMusicOptions, FetchLike } from "./itunes";
export { normalizeQuery } from "./normalize";
export { rankSongResults } from "./rank";
export { pickArtistMatch } from "./artist-match";
export {
  itunesSearchResponseSchema,
  parseItunesSearchResponse,
} from "./schema";
export type { ItunesTrack, ItunesSearchResponse } from "./schema";
