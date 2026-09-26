import "server-only";
import type { SyncFailure } from "../../spotify/errors";
import { tokenNeedsRefresh } from "../../spotify/diff";
import { refreshTokens, type TokenSet } from "../../spotify/oauth";
import type { SpotifyMe } from "../../spotify/schema";
import { createServiceClient } from "../supabase/service";
import { spotifyConfig } from "./config";
import { check } from "./store";
import type { SyncOutcome } from "./sync-user";

export interface ConnectionRow {
  user_id: string;
  spotify_user_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  recent_cursor: string | null;
  last_daily_sync_at: string | null;
  last_attempt_at: string | null;
  last_synced_at: string | null;
  last_error_at: string | null;
}

// One literal: supabase-js types a select from its string, which a + breaks.
const CONNECTION_COLUMNS =
  "user_id, spotify_user_id, refresh_token, access_token, access_token_expires_at, recent_cursor, last_daily_sync_at, last_attempt_at, last_synced_at, last_error_at";

/** The Spotify account is already linked to a different june user. */
export class AlreadyLinkedError extends Error {
  constructor() {
    super("That Spotify account is already connected to another june account.");
    this.name = "AlreadyLinkedError";
  }
}

/** Save (or re-save, on reconnect) a user's connection. The cursor and daily
 *  timestamps aren't sent, so a reconnect keeps them. */
export async function saveConnection(userId: string, me: SpotifyMe, tokens: TokenSet): Promise<void> {
  if (tokens.refreshToken === null) {
    throw new Error("Spotify returned no refresh token. Try connecting again.");
  }
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .upsert(
      {
        user_id: userId,
        spotify_user_id: me.id,
        display_name: me.display_name ?? null,
        refresh_token: tokens.refreshToken,
        access_token: tokens.accessToken,
        access_token_expires_at: tokens.expiresAt.toISOString(),
        status: "active",
        last_error: null,
        last_error_at: null,
        // A new connection has no attempt yet, so the next run neither
        // mistakes the old one for a cut-off nor gates Sync now on it.
        last_attempt_at: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  // spotify_user_id is unique: one Spotify account, one june user.
  if (error?.code === "23505") throw new AlreadyLinkedError();
  check("save Spotify connection", error);
}

/** Longest-waiting first (never attempted before anyone), so a run that runs
 *  out of time can't skip the same users every time. */
export async function activeConnections(userId?: string): Promise<ConnectionRow[]> {
  let query = createServiceClient()
    .from("spotify_connections")
    .select(CONNECTION_COLUMNS)
    .eq("status", "active");
  if (userId !== undefined) query = query.eq("user_id", userId);
  const { data, error } = await query
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .order("connected_at");
  check("read Spotify connections", error);
  return (data ?? []) as ConnectionRow[];
}

/** A usable access token, refreshed and saved first when it has a minute or
 *  less left. A revoked grant throws SpotifyAuthError("invalid_grant"). */
export async function freshAccessToken(row: ConnectionRow, now: Date): Promise<string> {
  if (row.access_token !== null && !tokenNeedsRefresh(row.access_token_expires_at, now)) {
    return row.access_token;
  }
  const tokens = await refreshTokens(row.refresh_token, spotifyConfig());
  const update: Record<string, string> = {
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.expiresAt.toISOString(),
  };
  if (tokens.refreshToken !== null) update.refresh_token = tokens.refreshToken;
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", row.user_id);
  check("save refreshed Spotify token", error);
  return tokens.accessToken;
}

/** Written before a user's sync does anything. An attempt with no success or
 *  error recorded after it means that run was cut off. */
export async function markAttempt(userId: string, now: Date): Promise<void> {
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update({ last_attempt_at: now.toISOString() })
    .eq("user_id", userId);
  check("mark Spotify sync attempt", error);
}

/** Saved as soon as a run's listens are stored, so a later stage failing
 *  can't make the next run fetch them again. */
export async function saveListenCursor(userId: string, cursor: string | null): Promise<void> {
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update({ recent_cursor: cursor })
    .eq("user_id", userId);
  check("save Spotify listens cursor", error);
}

/** Saved once every like has been read and the top lists stored, so a later
 *  stage failing can't make the next run repeat the daily pass. */
export async function saveDailyPass(userId: string, now: Date): Promise<void> {
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update({ last_daily_sync_at: now.toISOString() })
    .eq("user_id", userId);
  check("save Spotify daily pass", error);
}

/** The run finished. Repeats the cursor and daily timestamp already saved as
 *  progress, which is harmless, and clears the last error. */
export async function recordSuccess(userId: string, outcome: SyncOutcome, now: Date): Promise<void> {
  const update: Record<string, string | null> = {
    recent_cursor: outcome.recentCursor,
    last_synced_at: now.toISOString(),
    last_error: null,
    last_error_at: null,
  };
  if (outcome.dailyDone) update.last_daily_sync_at = now.toISOString();
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", userId);
  check("record Spotify sync", error);
}

export async function recordFailure(userId: string, failure: SyncFailure, now: Date): Promise<void> {
  const update: Record<string, string> = {
    last_error: failure.message,
    last_error_at: now.toISOString(),
  };
  if (failure.kind === "revoked") update.status = "revoked";
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", userId);
  check("record Spotify sync failure", error);
}

/** Whether the user is connected, its status, and when a sync last started
 *  (for Sync now). */
export async function connectionSyncState(
  userId: string,
): Promise<
  { connected: false } | { connected: true; status: "active" | "revoked"; lastAttemptAt: string | null }
> {
  const { data, error } = await createServiceClient()
    .from("spotify_connections")
    .select("status, last_attempt_at")
    .eq("user_id", userId)
    .maybeSingle();
  check("read Spotify connection", error);
  if (data === null) return { connected: false };
  const row = data as { status: "active" | "revoked"; last_attempt_at: string | null };
  return { connected: true, status: row.status, lastAttemptAt: row.last_attempt_at };
}

/** The lease holder id, or null when another run holds it. */
export async function claimSyncLease(seconds: number): Promise<string | null> {
  const { data, error } = await createServiceClient().rpc("claim_spotify_sync", {
    p_seconds: seconds,
  });
  check("claim Spotify sync lease", error);
  return (data as string | null) ?? null;
}

export async function releaseSyncLease(holder: string): Promise<void> {
  const { error } = await createServiceClient().rpc("release_spotify_sync", { p_holder: holder });
  check("release Spotify sync lease", error);
}

/** Drops the tokens. The library stays. */
export async function deleteConnection(userId: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .delete()
    .eq("user_id", userId);
  check("delete Spotify connection", error);
}

// The delete is a single RPC statement, so a short lease is plenty.
const DELETE_LEASE_SECONDS = 60;

/** Drops the tokens and everything synced from Spotify for this user. Shared
 *  songs rows stay: they name no user. Waits out a running sync by claiming
 *  the sync lease first, then deletes everything in one transaction via the
 *  delete_spotify_data RPC, so a failure can't leave the user disconnected
 *  with no data deleted. Returns "busy" instead of deleting when a sync
 *  already holds the lease. */
export async function deleteSpotifyData(userId: string): Promise<"deleted" | "busy"> {
  const holder = await claimSyncLease(DELETE_LEASE_SECONDS);
  if (holder === null) return "busy";
  try {
    const { error } = await createServiceClient().rpc("delete_spotify_data", { p_user: userId });
    check("delete Spotify data", error);
    return "deleted";
  } finally {
    await releaseSyncLease(holder);
  }
}
