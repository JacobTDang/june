import { z } from "zod";

/** Response of mp3server's POST /files/by-video/{videoId}/link. */
export const linkResponseSchema = z.object({
  url: z.string().startsWith("/"),
  expires_at: z.number(),
});

/** One job in mp3server's GET /downloads response. Status is left as a plain
 *  string (not an enum) — the caller treats anything not queued/running as
 *  terminal, so an unrecognized future status must not fail validation. */
export const downloadJobSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.string(),
  progress: z.number(),
  /** ISO 8601 timestamp — the server models this as a datetime, which
   * serializes to a string, not the epoch number the sibling link response
   * uses for `expires_at`. Verified against the running server. */
  created_at: z.string(),
});

export const downloadsResponseSchema = z.array(downloadJobSchema);

/** One download job as the server actually sends it. Derived from the schema
 *  so the wire format has a single definition — every consumer narrows from
 *  this rather than re-declaring the shape. */
export type DownloadJob = z.infer<typeof downloadJobSchema>;
