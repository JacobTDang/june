import { when } from "../when";

/** What /library says for each ?spotify_error= the callback sends back. An
 *  unknown code is an error message from the callback, shown as it is. */
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
    default:
      return `Couldn't connect Spotify: ${code}`;
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
