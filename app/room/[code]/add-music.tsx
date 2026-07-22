"use client";

import { useState } from "react";
import { Plus, Music, ArrowLeft, Disc3, ChevronRight } from "lucide-react";
import type { MusicCandidate, ArtistCandidate } from "@/src/discovery";
import type { VideoMeta } from "@/src/lib/video-cache";
import {
  addByLink,
  addCandidate,
  addVideoById,
  getArtistTopSongsAction,
  getPlaylistTracks,
  importPlaylistToRoom,
  listMyPlaylists,
  searchMusicAction,
} from "@/src/lib/room/add-music";
import {
  describeYouTubeError,
  youTubeNoticeText,
} from "@/src/lib/supabase/youtube-error";
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
  const [results, setResults] = useState<MusicCandidate[]>([]);
  const [artist, setArtist] = useState<ArtistCandidate | null>(null);
  const [artistView, setArtistView] = useState<ArtistCandidate | null>(null);
  const [artistSongs, setArtistSongs] = useState<MusicCandidate[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [openPlaylist, setOpenPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<VideoMeta[] | null>(null);

  const trimmed = query.trim();
  const isLink = YT_LINK.test(trimmed);

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

  /** Run a YouTube-touching load, surfacing calm copy for setup/connection issues. */
  async function youtubeLoad<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new Error(youTubeNoticeText(describeYouTubeError(err)));
    }
  }

  function loadPlaylists() {
    void run(async () => setPlaylists(await youtubeLoad(listMyPlaylists)));
  }

  function browsePlaylist(p: Playlist) {
    setOpenPlaylist(p);
    setPlaylistTracks(null);
    void run(async () => setPlaylistTracks(await youtubeLoad(() => getPlaylistTracks(p.id))));
  }

  function clearSearch() {
    setQuery("");
    setResults([]);
    setArtist(null);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (isLink) {
      // Paste-a-link, folded into the same field.
      void run(
        () => addByLink(roomId, trimmed),
        () => {
          clearSearch();
          return "Added to the queue.";
        },
      );
    } else {
      void run(async () => {
        const result = await searchMusicAction(trimmed);
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
              () => addCandidate(roomId, c),
              () => {
                clearSearch();
                return `Added “${c.title}”`;
              },
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

      {tab === "search" && !artistView && (
        <>
          <form className="add__search" onSubmit={submitSearch}>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a song, or paste a YouTube link"
              aria-label="Search or paste a link"
            />
            <button type="submit" className={isLink ? "btn btn--primary" : "btn"} disabled={busy}>
              {isLink ? "Add" : "Search"}
            </button>
          </form>
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
                  () => youtubeLoad(() => importPlaylistToRoom(roomId, openPlaylist.id)),
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
