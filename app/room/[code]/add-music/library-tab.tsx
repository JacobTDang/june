"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, LoaderCircle, Plus } from "lucide-react";
import {
  listLikedForRoom,
  listPlaylistSongsForRoom,
  listPlaylistsForRoom,
  queueLibraryPlaylist,
  queueLibrarySong,
} from "@/src/lib/room/library";
import { rowMatchesFilter, rowNote, type LibraryRow } from "@/src/lib/room/library-rows";
import type { LibraryPlaylist } from "@/src/lib/spotify/library";
import { Cover } from "./cover";
import { unwrap, type AddRunner } from "./runner";

type View = "liked" | "playlists";

/** The user's Spotify library: liked songs (filterable) and their own
 *  playlists, each song addable once it's matched to a video. */
export function LibraryTab({ roomId, runner, active }: { roomId: string; runner: AddRunner; active: boolean }) {
  const { busy, run } = runner;
  const [view, setView] = useState<View>("liked");
  const [liked, setLiked] = useState<LibraryRow[] | null>(null);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<{ playlist: LibraryPlaylist; rows: LibraryRow[] | null } | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    run(async () => {
      try {
        const [songs, lists] = await Promise.all([listLikedForRoom(), listPlaylistsForRoom()]);
        setLiked(unwrap(songs));
        setPlaylists(unwrap(lists));
      } catch (e) {
        setLoadFailed(true);
        throw e;
      }
    });
  }, [run]);

  // Loaded the first time the tab is shown, not with the room: most jams
  // never open it.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!active || started) return;
    setStarted(true);
    load();
  }, [active, started, load]);

  /** A queued song is matched by now, even if the list still said otherwise. */
  function markReady(songId: string) {
    const ready = (rows: LibraryRow[]) =>
      rows.map((r) => (r.songId === songId ? { ...r, state: "ready" as const } : r));
    setLiked((rows) => (rows ? ready(rows) : rows));
    setOpen((current) => (current?.rows ? { ...current, rows: ready(current.rows) } : current));
  }

  function queue(row: LibraryRow) {
    run(
      async () => {
        const notice = unwrap(await queueLibrarySong(roomId, row.songId));
        markReady(row.songId);
        return notice;
      },
      (notice) => notice,
    );
  }

  function openPlaylist(playlist: LibraryPlaylist) {
    setOpen({ playlist, rows: null });
    run(async () => {
      const rows = unwrap(await listPlaylistSongsForRoom(playlist.id));
      setOpen((current) => (current?.playlist.id === playlist.id ? { playlist, rows } : current));
    });
  }

  function songList(rows: LibraryRow[]) {
    return (
      <ul className="add__list">
        {rows.map((row) => (
          <li
            key={row.songId}
            className={row.state === "unavailable" ? "add__result add__result--off" : "add__result"}
          >
            <Cover url={row.artworkUrl} />
            <div className="add__meta">
              <div className="add__title">{row.title}</div>
              <div className="add__sub">
                {row.artists}
                {rowNote(row)}
                {row.state === "matching" && <LoaderCircle className="spin add__spin" size={11} aria-hidden />}
              </div>
            </div>
            <button
              className="add__btn"
              disabled={busy || row.state === "unavailable"}
              aria-label={`Add ${row.title}`}
              onClick={() => queue(row)}
            >
              <Plus size={16} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  if (liked === null || playlists === null) {
    return loadFailed ? (
      <p className="muted">
        Couldn’t load your library.{" "}
        <button className="btn btn--sm" disabled={busy} onClick={load}>
          Try again
        </button>
      </p>
    ) : (
      <p className="muted">Loading your library…</p>
    );
  }

  if (liked.length === 0 && playlists.length === 0) {
    return (
      <p className="muted">
        Nothing here yet. Connect Spotify on your <Link href="/library">Library</Link> page and your liked
        songs and playlists show up here.
      </p>
    );
  }

  if (open) {
    return (
      <>
        <div className="add__plhead">
          <button className="btn btn--sm" onClick={() => setOpen(null)}>
            <ArrowLeft size={15} />
            Playlists
          </button>
          <span className="add__pltitle">{open.playlist.name}</span>
          <button
            className="btn btn--sm"
            disabled={busy}
            onClick={() =>
              run(
                async () => unwrap(await queueLibraryPlaylist(roomId, open.playlist.id)),
                (summary) => summary,
              )
            }
          >
            Queue playlist
          </button>
        </div>
        {open.rows === null ? <p className="muted">Loading songs…</p> : songList(open.rows)}
      </>
    );
  }

  const shown = liked.filter((row) => rowMatchesFilter(row, filter));

  return (
    <>
      <div className="add__switch" role="group" aria-label="Library view">
        {(["liked", "playlists"] as const).map((v) => (
          <button
            key={v}
            className={view === v ? "btn btn--sm btn--primary" : "btn btn--sm"}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v === "liked" ? "Liked" : "Playlists"}
          </button>
        ))}
      </div>

      {view === "liked" ? (
        liked.length === 0 ? (
          <p className="muted">No liked songs yet.</p>
        ) : (
          <>
            <input
              className="input add__filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter your liked songs"
              aria-label="Filter liked songs"
            />
            {shown.length === 0 ? (
              <p className="muted">No liked songs match “{filter.trim()}”.</p>
            ) : (
              songList(shown)
            )}
          </>
        )
      ) : playlists.length === 0 ? (
        <p className="muted">No playlists yet. Only playlists you made or collaborate on come across.</p>
      ) : (
        <ul className="add__list">
          {playlists.map((p) => (
            <li key={p.id}>
              <button
                className="add__artistchip"
                disabled={busy}
                onClick={() => openPlaylist(p)}
                aria-label={`Open ${p.name}`}
              >
                <Cover url={p.artworkUrl} />
                <div className="add__meta">
                  <div className="add__title">{p.name}</div>
                  <div className="add__sub">
                    {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                  </div>
                </div>
                <ChevronRight className="add__chev" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
