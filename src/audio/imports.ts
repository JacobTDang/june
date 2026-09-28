import { z } from "zod";
import { createServiceRequest, errorDetail, type ServiceConfig } from "./service-request";

/**
 * mp3server's import and match routes, called server-to-server with the
 * shared service token, for the background library matching and for matching
 * one song when someone clicks it. Validated at the boundary like the rest of
 * src/audio.
 */

export const importTrackStateSchema = z.object({
  title: z.string(),
  artist: z.string(),
  // "pending" | "resolved" | "not_found" | "failed" | "canceled"; kept as a
  // string so a future state fails where it's interpreted, not here
  state: z.string(),
  video_id: z.string().nullish(),
  matched_title: z.string().nullish(),
  confidence: z.string().nullish(),
  matched_duration_ms: z.number().int().nullish(),
  error: z.string().nullish(),
});

export const importStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  total: z.number().int(),
  done: z.number().int(),
  tracks: z.array(importTrackStateSchema),
});

const importCreatedSchema = z.object({ id: z.string(), total: z.number().int() });

export const matchResultSchema = z.object({
  state: z.enum(["resolved", "not_found"]),
  video_id: z.string().nullish(),
  matched_title: z.string().nullish(),
  confidence: z.string().nullish(),
  matched_duration_ms: z.number().int().nullish(),
});

export type ImportTrackState = z.infer<typeof importTrackStateSchema>;
export type ImportStatus = z.infer<typeof importStatusSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;

export interface TrackToMatch {
  title: string;
  artist: string;
  durationMs: number | null;
}

export interface ImportService {
  createImport(tracks: TrackToMatch[]): Promise<{ id: string; total: number }>;
  /** Null when the server no longer has the import (pruned past retention). */
  getImport(id: string): Promise<ImportStatus | null>;
  matchOne(track: TrackToMatch): Promise<MatchResult>;
}

/** mp3server's 404 detail on GET /imports/{id}. */
const IMPORT_NOT_FOUND = "import not found";

function toWire(track: TrackToMatch) {
  return { title: track.title, artist: track.artist, duration_ms: track.durationMs };
}

export function createImportService(config: ServiceConfig): ImportService {
  const request = createServiceRequest(config, "createImportService");

  return {
    async createImport(tracks) {
      const response = await request.send("POST", "/imports", { tracks: tracks.map(toWire) });
      if (!response.ok) return request.fail("/imports", response);
      return importCreatedSchema.parse(await response.json());
    },

    async getImport(id) {
      const path = `/imports/${encodeURIComponent(id)}`;
      const response = await request.send("GET", path);
      if (response.status === 404) {
        // Only mp3server's own answer means the import is gone. Any other 404
        // (a proxy, a wrong base URL) would otherwise resubmit every song.
        const detail = await errorDetail(response);
        if (detail === IMPORT_NOT_FOUND) return null;
        throw request.error(path, 404, detail);
      }
      if (!response.ok) return request.fail(path, response);
      return importStatusSchema.parse(await response.json());
    },

    async matchOne(track) {
      const response = await request.send("POST", "/match", toWire(track));
      if (!response.ok) return request.fail("/match", response);
      return matchResultSchema.parse(await response.json());
    },
  };
}
