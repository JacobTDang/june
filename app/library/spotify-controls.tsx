"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteSpotifyDataAction,
  disconnectSpotifyAction,
  syncNowAction,
  type ActionResult,
} from "@/src/lib/spotify/actions";

// Long enough to mean it, short enough that a later click can't delete by surprise
const DELETE_CONFIRMATION_TIMEOUT = 5000;

/**
 * The connection's buttons. Times are formatted on the server and passed in
 * as text, so the client never renders a relative time that differs from the
 * server's. The delete button also shows after a plain Disconnect while synced
 * data is still in june, so it can always be removed.
 */
export function SpotifyControls({
  connected,
  revoked,
  line,
  error,
  hasLibrary,
}: {
  connected: boolean;
  revoked: boolean;
  line: string | null;
  error: string | null;
  hasLibrary: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timeout = setTimeout(() => setConfirmingDelete(false), DELETE_CONFIRMATION_TIMEOUT);
    return () => clearTimeout(timeout);
  }, [confirmingDelete]);

  const run = (action: () => Promise<ActionResult>) => {
    setConfirmingDelete(false);
    startTransition(async () => {
      try {
        setResult(await action());
      } catch (err) {
        setResult({ ok: false, notice: err instanceof Error ? err.message : String(err) });
      }
    });
  };

  // Two clicks: the first arms it, the second (within the timeout) deletes.
  const deleteButton = (label: string) => (
    <button
      className="btn btn--sm"
      disabled={pending}
      onClick={() => {
        if (!confirmingDelete) {
          setConfirmingDelete(true);
          return;
        }
        run(deleteSpotifyDataAction);
      }}
    >
      {confirmingDelete ? "Click again to delete everything" : label}
    </button>
  );

  const notice = result && (
    <p className={`lib__notice${result.ok ? "" : " lib__notice--error"}`} role="status">
      {result.notice}
    </p>
  );

  if (!connected) {
    return (
      <div className="lib__connect">
        <p className="muted">
          Connect Spotify to bring your liked songs, playlists and listening into june. Spotify
          limits june to five accounts, so ask Jacob before connecting.
        </p>
        <div className="lib__actions">
          <a className="btn btn--primary" href="/api/spotify/connect">
            Connect Spotify
          </a>
          {hasLibrary && deleteButton("Delete my Spotify data")}
        </div>
        {notice}
      </div>
    );
  }

  return (
    <div className="lib__status">
      {line && <p className="lib__line">{line}</p>}
      {error && (
        <p className="lib__notice lib__notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="lib__actions">
        {revoked ? (
          <a className="btn btn--sm" href="/api/spotify/connect">
            Reconnect
          </a>
        ) : (
          <button className="btn btn--sm" disabled={pending} onClick={() => run(syncNowAction)}>
            Sync now
          </button>
        )}
        <button className="btn btn--sm" disabled={pending} onClick={() => run(disconnectSpotifyAction)}>
          Disconnect
        </button>
        {deleteButton("Disconnect and delete my Spotify data")}
      </div>
      {notice}
    </div>
  );
}
