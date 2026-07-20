"use client";

import { useState } from "react";
import type { MusicCandidate } from "@/src/discovery";
import {
  addByLink,
  addCandidate,
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

      {tab === "playlist" && (
        <div className="stack" style={{ alignItems: "stretch" }}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => setPlaylists(await listMyPlaylists()))}
          >
            Load my playlists
          </button>
          {playlists && (
            <ul className="list">
              {playlists.map((p) => (
                <li key={p.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    <strong>{p.title}</strong>
                    <span className="muted"> · {p.itemCount} songs</span>
                  </span>
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
                    Import
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
