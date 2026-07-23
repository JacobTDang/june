"use client";

import { useState } from "react";
import { Music, ChevronRight, RefreshCw } from "lucide-react";
import { filterPlaylists } from "@/src/lib/room/playlist-window";

export type Playlist = {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl?: string | null;
};

/**
 * Playlists as a vertical, windowed list: a cover, the title, and its song
 * count per row. It scrolls with a plain trackpad — the same top-to-bottom
 * gesture as the search results — and never grows past the window, so a big
 * collection can't stretch the page. Tap a row to open its songs.
 */
export function PlaylistCarousel({
  playlists,
  busy,
  onOpen,
  onRefresh,
}: {
  playlists: Playlist[];
  busy: boolean;
  onOpen: (p: Playlist) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = filterPlaylists(playlists, query);

  return (
    <div className="plc">
      <div className="plc__bar">
        <input
          className="input plc__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your playlists"
          aria-label="Search your playlists"
        />
        <button
          className="btn btn--sm"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh playlists"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="muted plc__empty">No playlists match “{query}”.</p>
      ) : (
        <div className="plc-list">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className="plc-row"
              onClick={() => onOpen(p)}
              disabled={busy}
            >
              <span className="plc-row__cover">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <Music size={18} />
                )}
              </span>
              <span className="plc-row__body">
                <span className="plc-row__name" title={p.title}>
                  {p.title}
                </span>
                <span className="plc-row__count">
                  {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                </span>
              </span>
              <ChevronRight className="plc-row__go" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
