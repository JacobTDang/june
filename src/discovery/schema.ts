import { z } from "zod";

/**
 * Zod boundary validation for the iTunes Search API. Only the fields we use are
 * declared; Zod strips the rest. `trackName`/`artistName` are optional because
 * the API can return rows without them — those get skipped downstream rather
 * than failing the whole response.
 */
const itunesTrackSchema = z.object({
  trackId: z.number(),
  trackName: z.string().optional(),
  artistName: z.string().optional(),
  collectionName: z.string().optional(),
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
