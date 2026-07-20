"use client";

import { useState } from "react";
import { Plus, Music, ArrowLeft } from "lucide-react";
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

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "link", label: "Paste link" },
  { id: "playlist", label: "My playlists" },
];

/** A consistently framed cover thumbnail, with a music-note fallback. */
function Cover({ url }: { url?: string | null }) {
  return (
    <div className="add__cover">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        <Music size={16} />
      )}
    </div>
  );
}

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
    <div className="card add">
      <div className="add__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`add__tab${tab === t.id ? " add__tab--on" : ""}`}
            onClick={() => {
              setTab(t.id);
              setMessage(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "search" && (
        <>
          <form
            className="add__search"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => setResults(await searchMusicAction(query)));
            }}
          >
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a song or artist"
              aria-label="Search"
            />
            <button type="submit" className="btn" disabled={busy}>
              Search
            </button>
          </form>
          {results.length > 0 && (
            <ul className="add__list">
              {results.map((c) => (
                <li key={c.sourceId} className="add__result">
                  <Cover url={c.artworkUrl} />
                  <div className="add__meta">
                    <div className="add__title">{c.title}</div>
                    <div className="add__sub">{c.artist}</div>
                  </div>
                  <button
                    className="add__btn"
                    disabled={busy}
                    aria-label={`Add ${c.title}`}
                    onClick={() =>
                      void run(() => addCandidate(roomId, c), () => `Added “${c.title}”`)
                    }
                  >
                    <Plus size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "link" && (
        <form
          className="add__search"
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
            className="input"
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
        <>
          <button
            className="btn"
            disabled={busy}
            onClick={() => void run(async () => setPlaylists(await listMyPlaylists()))}
          >
            {playlists ? "Refresh playlists" : "Load my playlists"}
          </button>
          {playlists && (
            <ul className="add__list">
              {playlists.map((p) => (
                <li key={p.id} className="add__prow">
                  <button
                    className="add__pmeta"
                    disabled={busy}
                    onClick={() => {
                      setOpenPlaylist(p);
                      setPlaylistTracks(null);
                      void run(async () => setPlaylistTracks(await getPlaylistTracks(p.id)));
                    }}
                  >
                    <span className="add__title">{p.title}</span>
                    <span className="add__sub">
                      {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                    </span>
                  </button>
                  <button
                    className="btn btn--sm"
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
        </>
      )}

      {tab === "playlist" && openPlaylist && (
        <>
          <div className="add__plhead">
            <button
              className="btn btn--sm"
              onClick={() => {
                setOpenPlaylist(null);
                setPlaylistTracks(null);
              }}
            >
              <ArrowLeft size={15} />
              Playlists
            </button>
            <span className="add__pltitle">{openPlaylist.title}</span>
            <button
              className="btn btn--sm"
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
            <ul className="add__list">
              {playlistTracks.map((t) => (
                <li key={t.videoId} className="add__result">
                  <Cover url={t.thumbnailUrl} />
                  <div className="add__meta">
                    <div className="add__title">{t.title}</div>
                    <div className="add__sub">
                      {t.artist ?? ""}
                      {!t.embeddable ? " · can’t play here" : ""}
                    </div>
                  </div>
                  <button
                    className="add__btn"
                    disabled={busy || !t.embeddable}
                    aria-label={`Add ${t.title}`}
                    onClick={() =>
                      void run(() => addVideoById(roomId, t.videoId), () => `Added “${t.title}”`)
                    }
                  >
                    <Plus size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {message && <p className="add__msg">{message}</p>}
    </div>
  );
}
