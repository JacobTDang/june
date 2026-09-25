import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getLibraryPlaylists,
  getLikedSongs,
  getRecentListens,
  getSpotifyStatus,
} from "@/src/lib/spotify/library";
import { connectErrorText, spotifyStatusLine } from "@/src/lib/spotify/messages";
import { createClient } from "@/src/lib/supabase/server";
import { when } from "@/src/lib/when";
import { SongList } from "./song-list";
import { SpotifyControls } from "./spotify-controls";

const LIKED_SHOWN = 100;
const LISTENS_SHOWN = 30;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ spotify?: string; spotify_error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/?next=${encodeURIComponent("/library")}`);

  const sp = await searchParams;
  const now = Date.now();
  // Read even when not connected: a plain Disconnect keeps the library, and
  // it stays on show (and deletable) until the user deletes it.
  const [status, liked, playlists, listens] = await Promise.all([
    getSpotifyStatus(),
    getLikedSongs(user.id, LIKED_SHOWN),
    getLibraryPlaylists(user.id),
    getRecentListens(user.id, LISTENS_SHOWN),
  ]);
  const hasLibrary = liked.total > 0 || playlists.length > 0 || listens.length > 0;
  const showLibrary = status !== null || hasLibrary;

  const syncError =
    status?.lastError != null
      ? `Last sync failed${status.lastErrorAt ? ` ${when(status.lastErrorAt, now)}` : ""}: ${status.lastError}`
      : null;

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <header className="pl__head">
        <h1 className="pl__title">Your library</h1>
        {showLibrary && (
          <span className="pl__count">
            {liked.total} liked · {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
          </span>
        )}
      </header>

      {sp.spotify_error && (
        <p className="lib__notice lib__notice--error" role="alert">
          {connectErrorText(sp.spotify_error)}
        </p>
      )}
      {sp.spotify === "connected" && (
        <p className="lib__notice" role="status">
          Spotify connected. Your library is syncing; refresh in a minute.
        </p>
      )}

      <SpotifyControls
        connected={status !== null}
        revoked={status?.status === "revoked"}
        line={status ? spotifyStatusLine(status, now) : null}
        error={syncError}
        hasLibrary={hasLibrary}
      />

      {showLibrary && (
        <>
          <section className="lib__section">
            <div className="eyebrow">Liked songs</div>
            {liked.songs.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <>
                <SongList songs={liked.songs} now={now} />
                {liked.total > liked.songs.length && (
                  <p className="muted">and {liked.total - liked.songs.length} more</p>
                )}
              </>
            )}
          </section>

          <section className="lib__section">
            <div className="eyebrow">Playlists</div>
            {playlists.length === 0 ? (
              <p className="muted">
                No playlists yet. Only playlists you made or collaborate on come across.
              </p>
            ) : (
              <ul className="pl__grid">
                {playlists.map((p) => (
                  <li key={p.id} className="pl__item">
                    <div className={`pl__cover${p.artworkUrl ? "" : " pl__cover--empty"}`}>
                      {p.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.artworkUrl} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden="true">♪</span>
                      )}
                    </div>
                    <div className="pl__meta">
                      <div className="pl__name" title={p.name}>
                        {p.name}
                      </div>
                      <div className="pl__sub">
                        {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lib__section">
            <div className="eyebrow">Recently played on Spotify</div>
            {listens.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <SongList songs={listens} now={now} />
            )}
          </section>
        </>
      )}
    </main>
  );
}
