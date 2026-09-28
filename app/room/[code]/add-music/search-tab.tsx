"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Disc3, Plus } from "lucide-react";
import type { ArtistCandidate, MusicCandidate } from "@/src/discovery";
import {
  AUTO_SEARCH_DEBOUNCE_MS,
  createRequestGate,
  shouldAutoSearch,
} from "@/src/discovery/typeahead";
import {
  addByLink,
  addCandidate,
  addPlaylistByLink,
  getArtistTopSongsAction,
  getPlaylistByLink,
  searchMusicAction,
} from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import { parsePlaylistId } from "@/src/youtube/url";
import type { Playlist } from "../playlist-carousel";
import { Cover } from "./cover";
import { PlaylistView } from "./playlist-view";
import { unwrap, type AddRunner } from "./runner";

/** A pasted YouTube link is added directly; anything else is searched. */
const YT_LINK = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;

interface PastedPlaylist {
  link: string;
  playlist: Playlist;
  tracks: VideoMeta[];
  truncated: boolean;
}

/** Search as you type, the artist view it opens, and a pasted playlist link
 *  opened for picking. */
export function SearchTab({ roomId, runner }: { roomId: string; runner: AddRunner }) {
  const { busy, run } = runner;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchGate = useRef(createRequestGate());
  const [results, setResults] = useState<MusicCandidate[]>([]);
  const [artist, setArtist] = useState<ArtistCandidate | null>(null);
  const [artistView, setArtistView] = useState<ArtistCandidate | null>(null);
  const [artistSongs, setArtistSongs] = useState<MusicCandidate[] | null>(null);
  const [pasted, setPasted] = useState<PastedPlaylist | null>(null);

  const trimmed = query.trim();
  const isLink = YT_LINK.test(trimmed);
  // Only a link that names a playlist and no single video; the same rule the
  // server applies, so the button label matches what will happen.
  const isPlaylistLink = parsePlaylistId(trimmed) !== null;

  function clearSearch() {
    setQuery("");
    setResults([]);
    setArtist(null);
  }

  // Search while typing. The gate makes the newest request the only one that
  // can write results, so a slow response to a half-typed query can't land
  // last and replace better ones. Pressing Search still works and goes
  // through submitSearch — it shares the same gate, so whichever request was
  // started last wins there too.
  useEffect(() => {
    if (!shouldAutoSearch(query, isLink)) return;

    const timer = setTimeout(() => {
      const token = searchGate.current.begin();
      setSearching(true);
      void searchMusicAction(query.trim())
        .then((result) => {
          if (!searchGate.current.accept(token)) return;
          setResults(result.songs);
          setArtist(result.artist);
        })
        .catch(() => {
          // Typeahead is opportunistic: a failed keystroke-search leaves the
          // previous results alone and says nothing. Pressing Search runs the
          // same query through `run`, which does report the failure.
        })
        .finally(() => {
          if (searchGate.current.accept(token)) setSearching(false);
        });
    }, AUTO_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, isLink]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (isPlaylistLink) {
      // A playlist link opens the list to pick from rather than emptying it
      // into the room; "Add all" in that view is the whole-playlist path. A
      // link naming both a video and a playlist isn't a playlist link (see
      // parsePlaylistId), so sharing one track from a playlist still adds it.
      const link = trimmed;
      run(async () => {
        const view = unwrap(await getPlaylistByLink(link));
        setPasted({
          link,
          playlist: {
            id: view.playlist.id,
            title: view.playlist.title,
            itemCount: view.playlist.itemCount,
            thumbnailUrl: view.playlist.thumbnailUrl ?? undefined,
          },
          tracks: view.tracks,
          truncated: view.truncated,
        });
        clearSearch();
      });
    } else if (isLink) {
      // Paste-a-link, folded into the same field.
      run(
        async () => unwrap(await addByLink(roomId, trimmed)),
        () => {
          clearSearch();
          return "Added to the queue.";
        },
      );
    } else {
      const token = searchGate.current.begin();
      run(async () => {
        const result = await searchMusicAction(trimmed);
        if (!searchGate.current.accept(token)) return;
        setResults(result.songs);
        setArtist(result.artist);
      });
    }
  }

  function openArtist(a: ArtistCandidate) {
    setArtistView(a);
    setArtistSongs(null);
    run(async () => setArtistSongs(await getArtistTopSongsAction(a.artistId)));
  }

  function closeArtist() {
    setArtistView(null);
    setArtistSongs(null);
  }

  /** One addable song row, shared by the search results and the artist view. */
  function songRow(c: MusicCandidate) {
    return (
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
            run(
              async () => unwrap(await addCandidate(roomId, c)),
              // The results stay put: queueing one song from a search is
              // usually the first of several, and clearing the list made you
              // type the query again to add the next one.
              () => `Added “${c.title}”`,
            )
          }
        >
          <Plus size={16} />
        </button>
      </li>
    );
  }

  if (pasted) {
    return (
      <PlaylistView
        roomId={roomId}
        playlist={pasted.playlist}
        tracks={pasted.tracks}
        truncated={pasted.truncated}
        backLabel="Search"
        onBack={() => setPasted(null)}
        onAddAll={async () => unwrap(await addPlaylistByLink(roomId, pasted.link))}
        runner={runner}
      />
    );
  }

  if (artistView) {
    return (
      <>
        <div className="add__plhead">
          <button className="btn btn--sm" onClick={closeArtist}>
            <ArrowLeft size={15} />
            Back
          </button>
          <span className="add__pltitle">{artistView.name}</span>
        </div>
        {artistSongs === null ? (
          <p className="muted">Loading songs…</p>
        ) : artistSongs.length === 0 ? (
          <p className="muted">No songs found for this artist.</p>
        ) : (
          <ul className="add__list">{artistSongs.map(songRow)}</ul>
        )}
      </>
    );
  }

  return (
    <>
      <form className="add__search" onSubmit={submitSearch}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a song, or paste a YouTube link"
          aria-label="Search or paste a link"
        />
        <button
          type="submit"
          className={isLink || isPlaylistLink ? "btn btn--primary" : "btn"}
          disabled={busy}
        >
          {isPlaylistLink ? "Add playlist" : isLink ? "Add" : "Search"}
        </button>
      </form>
      {/* Only while nothing is on screen yet: once results are up, the
          next keystroke's search replaces them in place, and a spinner
          over stale-but-useful results is just flicker. */}
      {searching && results.length === 0 && (
        <p className="add__hint" role="status">
          Searching…
        </p>
      )}
      {artist && (
        <button
          className="add__artistchip"
          disabled={busy}
          onClick={() => openArtist(artist)}
          aria-label={`Open ${artist.name}`}
        >
          <div className="add__cover">
            <Disc3 size={16} />
          </div>
          <div className="add__meta">
            <div className="add__title">{artist.name}</div>
            <div className="add__sub">Artist{artist.genre ? ` · ${artist.genre}` : ""}</div>
          </div>
          <ChevronRight className="add__chev" size={16} />
        </button>
      )}
      {results.length > 0 && <ul className="add__list">{results.map(songRow)}</ul>}
    </>
  );
}
