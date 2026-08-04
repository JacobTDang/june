"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Music, ArrowLeft, Disc3, ChevronRight } from "lucide-react";
import type { MusicCandidate, ArtistCandidate } from "@/src/discovery";
import type { VideoMeta } from "@/src/lib/video-cache";
import {
  addByLink,
  addPlaylistByLink,
  getPlaylistByLink,
  addCandidate,
  addVideoById,
  getArtistTopSongsAction,
  getPlaylistTracks,
  importPlaylistToRoom,
  listMyPlaylists,
  searchMusicAction,
} from "@/src/lib/room/add-music";
import type { YouTubeResult } from "@/src/lib/supabase/youtube-error";
import { parsePlaylistId } from "@/src/youtube/url";
import {
  AUTO_SEARCH_DEBOUNCE_MS,
  createRequestGate,
  shouldAutoSearch,
} from "@/src/discovery/typeahead";
import { PlaylistCarousel, type Playlist } from "./playlist-carousel";

type Tab = "search" | "playlist";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "playlist", label: "My playlists" },
];

/** A pasted YouTube link is added directly; anything else is searched. */
const YT_LINK = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;

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
  const [searching, setSearching] = useState(false);
  const searchGate = useRef(createRequestGate());
  const [results, setResults] = useState<MusicCandidate[]>([]);
  const [artist, setArtist] = useState<ArtistCandidate | null>(null);
  const [artistView, setArtistView] = useState<ArtistCandidate | null>(null);
  const [artistSongs, setArtistSongs] = useState<MusicCandidate[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<VideoMeta[] | null>(null);
  // Set when the open playlist came from a pasted link rather than the user's
  // own playlists: it decides where "back" goes and which import "Add all"
  // uses (the pasted one needs no YouTube account).
  const [playlistLink, setPlaylistLink] = useState<string | null>(null);
  const [playlistTruncated, setPlaylistTruncated] = useState(false);

  const trimmed = query.trim();
  const isLink = YT_LINK.test(trimmed);
  // Only a link that names a playlist and no single video; the same rule the
  // server applies, so the button label matches what will happen.
  const isPlaylistLink = parsePlaylistId(trimmed) !== null;

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

  /** Unwrap a server action's result, throwing its notice so `run` shows it. A
   *  client-side throw isn't redacted the way the server's raw error would be. */
  function unwrap<T>(result: YouTubeResult<T>): T {
    if (!result.ok) throw new Error(result.notice);
    return result.data;
  }

  function loadPlaylists() {
    void run(async () => setPlaylists(unwrap(await listMyPlaylists())));
  }

  function browsePlaylist(p: Playlist) {
    setOpenPlaylist(p);
    setPlaylistTracks(null);
    void run(async () => setPlaylistTracks(unwrap(await getPlaylistTracks(p.id))));
  }

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
      void run(async () => {
        const view = unwrap(await getPlaylistByLink(link));
        setOpenPlaylist({
          id: view.playlist.id,
          title: view.playlist.title,
          itemCount: view.playlist.itemCount,
          thumbnailUrl: view.playlist.thumbnailUrl ?? undefined,
        });
        setPlaylistLink(link);
        setPlaylistTruncated(view.truncated);
        setPlaylistTracks(view.tracks);
        clearSearch();
      });
    } else if (isLink) {
      // Paste-a-link, folded into the same field.
      void run(
        async () => unwrap(await addByLink(roomId, trimmed)),
        () => {
          clearSearch();
          return "Added to the queue.";
        },
      );
    } else {
      const token = searchGate.current.begin();
      void run(async () => {
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
    void run(async () => setArtistSongs(await getArtistTopSongsAction(a.artistId)));
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
            void run(
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

  return (
    <div className="add">
      <div className="eyebrow">Add music</div>

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

      {tab === "search" && !artistView && !openPlaylist && (
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
      )}

      {tab === "search" && artistView && (
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
      )}

      {tab === "playlist" && !openPlaylist && (
        <>
          {!playlists ? (
            <button className="btn" disabled={busy} onClick={loadPlaylists}>
              Load my playlists
            </button>
          ) : (
            <PlaylistCarousel
              playlists={playlists}
              busy={busy}
              onOpen={browsePlaylist}
              onRefresh={loadPlaylists}
            />
          )}
        </>
      )}

      {openPlaylist && (
        <>
          <div className="add__plhead">
            <button
              className="btn btn--sm"
              onClick={() => {
                setOpenPlaylist(null);
                setPlaylistTracks(null);
                setPlaylistLink(null);
                setPlaylistTruncated(false);
              }}
            >
              <ArrowLeft size={15} />
              {playlistLink ? "Search" : "Playlists"}
            </button>
            <span className="add__pltitle">{openPlaylist.title}</span>
            <button
              className="btn btn--sm"
              disabled={busy}
              onClick={() =>
                void run(
                  async () =>
                    playlistLink
                      ? unwrap(await addPlaylistByLink(roomId, playlistLink))
                      : unwrap(await importPlaylistToRoom(roomId, openPlaylist.id)),
                  (n) => `Added ${n} songs.`,
                )
              }
            >
              Add all
            </button>
          </div>
          {playlistTruncated && (
            <p className="add__hint">
              Showing the first {playlistTracks?.length ?? 0} of {openPlaylist.itemCount}. “Add all”
              takes the whole playlist.
            </p>
          )}
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
                      void run(
                        async () => unwrap(await addVideoById(roomId, t.videoId)),
                        () => `Added “${t.title}”`,
                      )
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
