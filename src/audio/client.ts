import { downloadsResponseSchema, linkResponseSchema } from "./schema";

/** The one bit of `fetch` we use - injectable so tests need no network. */
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

/** One mp3server download job, narrowed to the fields callers use. */
export interface DownloadJob {
  id: string;
  url: string;
  status: string;
  progress: number;
  created_at: number;
}

/** The slice of mp3server the room player needs. */
export interface AudioServer {
  /** Absolute stream URL for a stored track, or null when it isn't stored yet. */
  mintStreamUrl(videoId: string): Promise<string | null>;
  /**
   * Ask the server to download a video. Idempotent: already-cached videos
   * complete near-instantly server-side. "throttled" = the per-user pending
   * cap; the caller's play-time polling covers the track regardless.
   */
  ensureDownload(videoId: string): Promise<"queued" | "throttled">;
  /** This user's download jobs, newest first. */
  listDownloads(limit?: number): Promise<DownloadJob[]>;
}

export interface AudioServerConfig {
  /** e.g. https://audio.example.com — trailing slash tolerated. */
  baseUrl: string;
  /** The user's Supabase access token; null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

export function createAudioServer(config: AudioServerConfig): AudioServer {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  async function post(path: string, body?: unknown): Promise<Response> {
    const accessToken = await config.getAccessToken();
    if (accessToken === null) throw new Error("audio server: not signed in");
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    const init: RequestInit = { method: "POST", headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return doFetch(new URL(`${baseUrl}${path}`), init);
  }

  async function get(path: string): Promise<Response> {
    const accessToken = await config.getAccessToken();
    if (accessToken === null) throw new Error("audio server: not signed in");
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    return doFetch(new URL(`${baseUrl}${path}`), { method: "GET", headers });
  }

  return {
    async mintStreamUrl(videoId) {
      const response = await post(`/files/by-video/${encodeURIComponent(videoId)}/link`);
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`audio server ${response.status}: ${await errorDetail(response)}`);
      }
      const { url } = linkResponseSchema.parse(await response.json());
      return `${baseUrl}${url}`;
    },

    async ensureDownload(videoId) {
      const response = await post("/downloads", {
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
      if (response.status === 429) return "throttled";
      if (!response.ok) {
        throw new Error(`audio server ${response.status}: ${await errorDetail(response)}`);
      }
      return "queued";
    },

    async listDownloads(limit) {
      const query = limit !== undefined ? `?limit=${limit}` : "";
      const response = await get(`/downloads${query}`);
      if (!response.ok) {
        throw new Error(`audio server ${response.status}: ${await errorDetail(response)}`);
      }
      return downloadsResponseSchema.parse(await response.json());
    },
  };
}
