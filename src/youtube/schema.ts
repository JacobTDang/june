import { z } from "zod";

/**
 * Zod schemas for the slices of the YouTube Data API we depend on. These run
 * at the network boundary: `parseVideoListResponse` turns untrusted JSON into
 * typed data, throwing a clear error if YouTube ever returns a shape we don't
 * expect — so bugs surface here, not as `undefined` deep in the app.
 *
 * Only the fields we actually use are declared; Zod strips everything else.
 */

const thumbnailSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const thumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});

/** A single item from a `videos.list` response (part=snippet,contentDetails,status). */
export const videoItemSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string().optional(),
    liveBroadcastContent: z.enum(["none", "live", "upcoming"]).optional(),
    thumbnails: thumbnailsSchema.optional(),
  }),
  contentDetails: z.object({
    duration: z.string(),
  }),
  // Present only when the `status` part is requested; absence means unknown.
  status: z
    .object({
      embeddable: z.boolean(),
    })
    .optional(),
});

export const videoListResponseSchema = z.object({
  items: z.array(videoItemSchema),
  nextPageToken: z.string().optional(),
});

export type YouTubeThumbnails = z.infer<typeof thumbnailsSchema>;
export type YouTubeVideoItem = z.infer<typeof videoItemSchema>;
export type YouTubeVideoListResponse = z.infer<typeof videoListResponseSchema>;

/** Validate a raw `videos.list` API response, throwing on any unexpected shape. */
export function parseVideoListResponse(json: unknown): YouTubeVideoListResponse {
  return videoListResponseSchema.parse(json);
}
