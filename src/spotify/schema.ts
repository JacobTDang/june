import { z } from "zod";

/**
 * Zod schemas for the Spotify Web API responses june reads, validated at the
 * network boundary as src/youtube/schema.ts does for YouTube: a shape Spotify
 * changes fails here, loudly, not as `undefined` deep in the sync. Only the
 * fields june uses are declared; Zod strips the rest.
 *
 * Field names follow the February 2026 API: a playlist entry's track is under
 * `item`, not `track`.
 */

const imageSchema = z.object({ url: z.string() });

/** A track anywhere Spotify lists one. Local files carry a null id; podcast
 *  episodes, which playlists can hold, have no artists or album. */
export const trackSchema = z.object({
  type: z.string(),
  id: z.string().nullable(),
  name: z.string(),
  duration_ms: z.number().int().nonnegative().optional(),
  is_local: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })).optional(),
  album: z
    .object({
      name: z.string(),
      // Largest first, as Spotify orders them.
      images: z.array(imageSchema).nullable().optional(),
    })
    .optional(),
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
});

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  // Present on the code exchange; on a refresh only when Spotify rotates it.
  refresh_token: z.string().min(1).optional(),
});

export const meSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().nullable().optional(),
});

export const recentlyPlayedSchema = z.object({
  items: z.array(z.object({ track: trackSchema, played_at: z.string() })),
});

function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next: z.string().nullable() });
}

export const savedTracksPageSchema = pageOf(
  z.object({ added_at: z.string(), track: trackSchema }),
);

export const playlistSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
  collaborative: z.boolean(),
  owner: z.object({ id: z.string() }),
  snapshot_id: z.string(),
  images: z.array(imageSchema).nullable().optional(),
});

export const playlistsPageSchema = pageOf(playlistSummarySchema);

export const playlistItemsPageSchema = pageOf(
  z.object({
    added_at: z.string().nullable().optional(),
    // Null when the entry's track was removed from Spotify's catalog.
    item: trackSchema.nullable(),
  }),
);

export const topArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  genres: z.array(z.string()).optional(),
  images: z.array(imageSchema).nullable().optional(),
});

export const topArtistsSchema = z.object({ items: z.array(topArtistSchema) });

export const topTracksSchema = z.object({ items: z.array(trackSchema) });

export type SpotifyTrack = z.infer<typeof trackSchema>;
export type SpotifyMe = z.infer<typeof meSchema>;
export type RecentlyPlayedItem = z.infer<typeof recentlyPlayedSchema>["items"][number];
export type SavedTracksPage = z.infer<typeof savedTracksPageSchema>;
export type SavedTrack = SavedTracksPage["items"][number];
export type PlaylistSummary = z.infer<typeof playlistSummarySchema>;
export type PlaylistItem = z.infer<typeof playlistItemsPageSchema>["items"][number];
export type TopArtist = z.infer<typeof topArtistSchema>;
