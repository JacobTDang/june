/** A non-OK answer from the Web API. On a 429, `retryAfterSeconds` carries
 *  Spotify's Retry-After when it sent one. */
export class SpotifyApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A refused token request. `code` is Spotify's OAuth error, e.g.
 *  "invalid_grant" when the user revoked june's access. */
export class SpotifyAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpotifyAuthError";
    this.code = code;
  }
}

export type SyncFailure =
  | { kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | { kind: "revoked"; message: string }
  | { kind: "failed"; message: string };

/**
 * What a failed sync means for the run. A 429 stops everyone, because
 * Development Mode counts quota across the whole developer account; a revoked
 * grant needs the user to reconnect; anything else is that user's alone.
 */
export function classifySyncError(err: unknown): SyncFailure {
  if (err instanceof SpotifyApiError && err.status === 429) {
    return { kind: "rate-limited", message: err.message, retryAfterSeconds: err.retryAfterSeconds };
  }
  if (err instanceof SpotifyAuthError && err.code === "invalid_grant") {
    return { kind: "revoked", message: err.message };
  }
  return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
}

/** Development Mode answers 403 for a Spotify account that hasn't been added
 *  in the developer dashboard. */
export function isNotApprovedForApp(err: unknown): boolean {
  return err instanceof SpotifyApiError && err.status === 403;
}
