/**
 * Requests to mp3server's service-token routes from june's server: the auth
 * header, a per-request timeout, and failures that keep mp3server's own
 * detail. The route clients (./imports.ts, ./pins.ts) validate the bodies.
 */

export class ServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

export type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface ServiceConfig {
  baseUrl: string;
  serviceToken: string;
  fetch?: FetchLike;
  /** Per request; a stuck call must not hold a sync run or a click. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** mp3server's `detail`, or the best description of a reply without one.
 *  Only ever used to build a thrown error, so nothing is swallowed. */
export async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

export interface ServiceRequest {
  send(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Response>;
  /** The error for a failed call, carrying mp3server's detail. */
  error(path: string, status: number, detail: string): ServiceError;
  /** Throws the error for a failed response. */
  fail(path: string, response: Response): Promise<never>;
}

/** `client` names the caller in configuration errors. */
export function createServiceRequest(config: ServiceConfig, client: string): ServiceRequest {
  if (!config.baseUrl) throw new Error(`${client}: baseUrl is required`);
  if (!config.serviceToken) throw new Error(`${client}: serviceToken is required`);
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function error(path: string, status: number, detail: string): ServiceError {
    return new ServiceError(status, `mp3server ${status} on ${path}: ${detail}`);
  }

  return {
    async send(method, path, body) {
      const headers: Record<string, string> = { Authorization: `Bearer ${config.serviceToken}` };
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return doFetch(new URL(`${baseUrl}${path}`), init);
    },
    error,
    async fail(path, response) {
      throw error(path, response.status, await errorDetail(response));
    },
  };
}
