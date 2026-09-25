import { when } from "../when";

/** What /library says for each ?spotify_error= the connect routes send back.
 *  The code comes from the URL, where anyone can write anything, so an unknown
 *  one gets a generic message and is never shown. The real error is logged
 *  on the server. */
export function connectErrorText(code: string): string {
  switch (code) {
    case "not_approved":
      return "Spotify hasn't approved this account for june yet — ask Jacob to add it.";
    case "already_linked":
      return "That Spotify account is already connected to another june account.";
    case "access_denied":
      return "Spotify connection cancelled.";
    case "state":
      return "That connection link expired or came from another session. Try connecting again.";
    case "missing_code":
      return "Spotify didn't send back a code. Try connecting again.";
    case "failed":
      return "Couldn't connect Spotify. Try again, and tell Jacob if it keeps happening.";
    case "not_configured":
      return "Spotify isn't set up on this server yet.";
    default:
      return "Couldn't connect Spotify. Try again.";
  }
}

export interface SpotifyStatusView {
  displayName: string | null;
  status: "active" | "revoked";
  lastSyncedAt: string | null;
}

export function spotifyStatusLine(status: SpotifyStatusView, now: number): string {
  if (status.status === "revoked") return "Spotify access was revoked. Reconnect to keep syncing.";
  const who = status.displayName ? ` as ${status.displayName}` : "";
  const synced = status.lastSyncedAt ? `last synced ${when(status.lastSyncedAt, now)}` : "not synced yet";
  return `Connected to Spotify${who} · ${synced}`;
}
