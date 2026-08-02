import { z } from "zod";

/** Response of mp3server's POST /files/by-video/{videoId}/link. */
export const linkResponseSchema = z.object({
  url: z.string().startsWith("/"),
  expires_at: z.number(),
});
