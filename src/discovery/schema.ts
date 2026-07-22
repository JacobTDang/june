import { z } from "zod";

/**
 * Zod boundary validation for the iTunes Search API. Only the fields we use are
 * declared; Zod strips the rest. Nearly everything is optional because the API
 * returns heterogeneous rows: song searches carry `trackId`/`trackName`, artist
 * searches and `lookup` responses carry `wrapperType:"artist"` with `artistId`
 * and no track fields. Rows missing what a given caller needs are skipped
 * downstream rather than failing the whole response.
 */
const itunesTrackSchema = z.object({
  wrapperType: z.string().optional(),
  trackId: z.number().optional(),
  trackName: z.string().optional(),
  artistId: z.number().optional(),
  artistName: z.string().optional(),
  collectionName: z.string().optional(),
  primaryGenreName: z.string().optional(),
  artworkUrl100: z.string().optional(),
  trackTimeMillis: z.number().optional(),
});

export const itunesSearchResponseSchema = z.object({
  resultCount: z.number(),
  results: z.array(itunesTrackSchema),
});

export type ItunesTrack = z.infer<typeof itunesTrackSchema>;
export type ItunesSearchResponse = z.infer<typeof itunesSearchResponseSchema>;

/** Validate a raw iTunes Search API response, throwing on an unexpected shape. */
export function parseItunesSearchResponse(json: unknown): ItunesSearchResponse {
  return itunesSearchResponseSchema.parse(json);
}
