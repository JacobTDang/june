"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Music, Play, RefreshCw } from "lucide-react";
import { filterPlaylists } from "@/src/lib/room/playlist-window";

export type Playlist = {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl?: string | null;
};

/**
 * Playlists as a sideways-scrolling row of Spotify-style cards: cover on top,
 * title + count below. Scroll/swipe horizontally; tap a card to open its songs.
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const filtered = filterPlaylists(playlists, query);

  // The focused card is whichever is nearest the rail's centre.
  const updateFocus = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const centre = el.scrollLeft + el.clientWidth / 2;
    let bestId: string | null = null;
    let best = Infinity;
    for (const child of Array.from(el.children)) {
      const c = child as HTMLElement;
      if (!c.dataset.id) continue;
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - centre);
      if (d < best) {
        best = d;
        bestId = c.dataset.id;
      }
    }
    setFocusedId(bestId);
  }, []);

  // Mouse wheel scrolls the rail sideways (trackpad horizontal swipe works
  // natively). Only hijack the wheel when there's actually somewhere to scroll.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Track the centred card as the rail scrolls (and when the list changes).
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFocus);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    updateFocus();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [updateFocus, filtered.length]);

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
        <div className="plc-rail" ref={railRef}>
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              data-id={p.id}
              className={`plc-scard${focusedId === p.id ? " plc-scard--focused" : ""}`}
              onClick={() => onOpen(p)}
              disabled={busy}
            >
              <span className={`plc-scard__cover${p.thumbnailUrl ? "" : " plc-scard__cover--empty"}`}>
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <Music size={26} />
                )}
                <span className="plc-scard__play" aria-hidden="true">
                  <Play size={16} fill="currentColor" strokeWidth={0} />
                </span>
              </span>
              <span className="plc-scard__body">
                <span className="plc-scard__name" title={p.title}>
                  {p.title}
                </span>
                <span className="plc-scard__count">
                  {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
