"use client";

import { useState } from "react";
import type { MusicCandidate } from "@/src/discovery";
import type { VideoMeta } from "@/src/lib/video-cache";
import {
  addByLink,
  addCandidate,
  addVideoById,
  getPlaylistTracks,
  importPlaylistToRoom,
  listMyPlaylists,
  searchMusicAction,
} from "@/src/lib/room/add-music";

type Tab = "search" | "link" | "playlist";
type Playlist = { id: string; title: string; itemCount: number };

const inputStyle: React.CSSProperties = {
  padding: "0.55rem 0.8rem",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--card)",
  fontSize: "0.95rem",
  fontFamily: "var(--font-sans)",
  flex: 1,
};

export function AddMusic({ roomId }: { roomId: string }) {
  const [tab, setTab] = useState<Tab>("search");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MusicCandidate[]>([]);
  const [link, setLink] = useState("");
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<VideoMeta[] | null>(null);

  async function run<T>(fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      if (ok) setMessage(ok(result));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: "1.5rem 0" }}>
      <div className="row" style={{ gap: "0.4rem", marginBottom: "1rem" }}>
        {(["search", "link", "playlist"] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? "btn btn--primary" : "btn"}
            onClick={() => {
              setTab(t);
              setMessage(null);
            }}
          >
            {t === "search" ? "Search" : t === "link" ? "Paste link" : "My playlists"}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <div className="stack" style={{ alignItems: "stretch" }}>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => setResults(await searchMusicAction(query)));
            }}
          >
            <input
              style={inputStyle}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a song or artist"
              aria-label="Search"
            />
            <button type="submit" className="btn" disabled={busy}>
              Search
            </button>
          </form>
          <ul className="list">
            {results.map((c) => (
              <li key={c.sourceId} className="row" style={{ justifyContent: "space-between" }}>
                <span className="row">
                  {c.artworkUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={c.artworkUrl} alt="" />
                  )}
                  <span>
                    <strong>{c.title}</strong>
                    <span className="muted"> · {c.artist}</span>
                  </span>
                </span>
                <button
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void run(() => addCandidate(roomId, c), () => `Added “${c.title}”`)}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "link" && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => addByLink(roomId, link),
              () => {
                setLink("");
                return "Added to the queue.";
              },
            );
          }}
        >
          <input
            style={inputStyle}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a YouTube link"
            aria-label="YouTube link"
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Add
          </button>
        </form>
      )}

      {tab === "playlist" && !openPlaylist && (
        <div className="stack" style={{ alignItems: "stretch" }}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => setPlaylists(await listMyPlaylists()))}
          >
            {playlists ? "Refresh playlists" : "Load my playlists"}
          </button>
          {playlists && (
            <ul className="list">
              {playlists.map((p) => (
                <li key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                  <button
                    className="btn"
                    style={{ flex: 1, justifyContent: "flex-start" }}
                    disabled={busy}
                    onClick={() => {
                      setOpenPlaylist(p);
                      setPlaylistTracks(null);
                      void run(async () => setPlaylistTracks(await getPlaylistTracks(p.id)));
                    }}
                  >
                    {p.title}
                    <span className="muted"> · {p.itemCount} songs</span>
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => importPlaylistToRoom(roomId, p.id),
                        (n) => `Added ${n} songs from “${p.title}”.`,
                      )
                    }
                  >
                    Add all
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "playlist" && openPlaylist && (
        <div className="stack" style={{ alignItems: "stretch" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button
              className="btn"
              onClick={() => {
                setOpenPlaylist(null);
                setPlaylistTracks(null);
              }}
            >
              ← Playlists
            </button>
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => importPlaylistToRoom(roomId, openPlaylist.id),
                  (n) => `Added ${n} songs.`,
                )
              }
            >
              Add all
            </button>
          </div>
          {playlistTracks === null ? (
            <p className="muted">Loading songs…</p>
          ) : (
            <ul className="list">
              {playlistTracks.map((t) => (
                <li key={t.videoId} className="row" style={{ justifyContent: "space-between" }}>
                  <span className="row">
                    {t.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={t.thumbnailUrl} alt="" />
                    )}
                    <span>
                      <strong>{t.title}</strong>
                      {t.artist && <span className="muted"> · {t.artist}</span>}
                      {!t.embeddable && <span className="muted"> · can’t play here</span>}
                    </span>
                  </span>
                  <button
                    className="btn btn--primary"
                    disabled={busy || !t.embeddable}
                    onClick={() =>
                      void run(() => addVideoById(roomId, t.videoId), () => `Added “${t.title}”`)
                    }
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          {message}
        </p>
      )}
    </div>
  );
}
