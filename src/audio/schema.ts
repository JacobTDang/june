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
  created_at: z.number(),
});

export const downloadsResponseSchema = z.array(downloadJobSchema);
