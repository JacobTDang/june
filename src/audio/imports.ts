import { z } from "zod";

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

export class ImportServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ImportServiceError";
    this.status = status;
  }
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ImportServiceConfig {
  baseUrl: string;
  serviceToken: string;
  fetch?: FetchLike;
  /** Per request; a stuck search must not hold a sync run or a click. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** mp3server's 404 detail on GET /imports/{id}. */
const IMPORT_NOT_FOUND = "import not found";

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

function toWire(track: TrackToMatch) {
  return { title: track.title, artist: track.artist, duration_ms: track.durationMs };
}

export function createImportService(config: ImportServiceConfig): ImportService {
  if (!config.baseUrl) throw new Error("createImportService: baseUrl is required");
  if (!config.serviceToken) throw new Error("createImportService: serviceToken is required");
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.serviceToken}` };
    const init: RequestInit = { method: body === undefined ? "GET" : "POST", headers, signal: AbortSignal.timeout(timeoutMs) };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return doFetch(new URL(`${baseUrl}${path}`), init);
  }

  function failure(path: string, status: number, detail: string): ImportServiceError {
    return new ImportServiceError(status, `mp3server ${status} on ${path}: ${detail}`);
  }

  async function fail(path: string, response: Response): Promise<never> {
    throw failure(path, response.status, await errorDetail(response));
  }

  return {
    async createImport(tracks) {
      const response = await call("/imports", { tracks: tracks.map(toWire) });
      if (!response.ok) return fail("/imports", response);
      return importCreatedSchema.parse(await response.json());
    },

    async getImport(id) {
      const path = `/imports/${encodeURIComponent(id)}`;
      const response = await call(path);
      if (response.status === 404) {
        // Only mp3server's own answer means the import is gone. Any other 404
        // (a proxy, a wrong base URL) would otherwise resubmit every song.
        const detail = await errorDetail(response);
        if (detail === IMPORT_NOT_FOUND) return null;
        throw failure(path, 404, detail);
      }
      if (!response.ok) return fail(path, response);
      return importStatusSchema.parse(await response.json());
    },

    async matchOne(track) {
      const response = await call("/match", toWire(track));
      if (!response.ok) return fail("/match", response);
      return matchResultSchema.parse(await response.json());
    },
  };
}
