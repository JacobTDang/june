"use client";

import { useEffect, useRef, useState } from "react";
import { Music, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { clampIndex, filterPlaylists } from "@/src/lib/room/playlist-window";

export type Playlist = {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl?: string | null;
};

const GAP = 48; // vertical px between stacked cards
const RENDER_RADIUS = 2.6; // how many cards each side of focus to render

/**
 * A stacked deck of playlists: the focused card sits up front, the rest recede
 * behind it. Drag (or scroll) vertically to spin the deck; tap the focused card
 * to open its songs, or tap a back card to bring it forward. Arrow keys work too.
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
  const [focus, setFocus] = useState(0);
  const [dragOffset, setDragOffset] = useState(0); // in card-units, live during drag
  const reduce = useReducedMotion() ?? false;

  const dragging = useRef(false);
  const moved = useRef(false);
  const startY = useRef(0);
  const deckRef = useRef<HTMLDivElement>(null);
  const lenRef = useRef(0);

  const filtered = filterPlaylists(playlists, query);
  lenRef.current = filtered.length;
  const f = clampIndex(focus, filtered.length);
  const focusF = f + dragOffset;
  const nearest = clampIndex(Math.round(focusF), filtered.length);

  // Spin the deck by scrolling/swiping over it — no click-drag needed. A
  // non-passive listener so we can stop the page from scrolling while spinning.
  useEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    let acc = 0;
    const STEP = 60;
    const onWheel = (e: WheelEvent) => {
      if (lenRef.current <= 1) return; // nothing to spin — let the page scroll
      e.preventDefault();
      acc += e.deltaY;
      while (Math.abs(acc) >= STEP) {
        const dir = Math.sign(acc);
        setFocus((prev) => clampIndex(prev + dir, lenRef.current));
        acc -= dir * STEP;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function step(delta: number) {
    setFocus(clampIndex(f + delta, filtered.length));
  }

  function onQuery(value: string) {
    setQuery(value);
    setFocus(0);
    setDragOffset(0);
  }

  function onPointerDown(e: React.PointerEvent) {
    dragging.current = true;
    moved.current = false;
    startY.current = e.clientY;
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dy = e.clientY - startY.current;
    if (Math.abs(dy) > 4) moved.current = true;
    setDragOffset(-dy / GAP);
  }
  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (moved.current) setFocus(clampIndex(Math.round(focusF), filtered.length));
    setDragOffset(0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if ((e.key === "Enter" || e.key === " ") && filtered[nearest]) {
      e.preventDefault();
      onOpen(filtered[nearest]);
    }
  }

  return (
    <div className="plc">
      <div className="plc__bar">
        <input
          className="input plc__search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
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
        <>
          <div
            ref={deckRef}
            className="plc-deck"
            role="listbox"
            aria-label="Your playlists"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
            onKeyDown={onKeyDown}
          >
            {filtered.map((p, i) => {
              const offset = i - focusF;
              if (Math.abs(offset) > RENDER_RADIUS) return null;
              const abs = Math.abs(offset);
              const isFocused = i === nearest;
              return (
                <motion.button
                  key={p.id}
                  type="button"
                  className={`plc-card${isFocused ? " plc-card--on" : ""}`}
                  role="option"
                  aria-selected={isFocused}
                  disabled={busy}
                  style={{ zIndex: 100 - Math.round(abs) }}
                  animate={{
                    y: offset * GAP,
                    scale: Math.max(0.72, 1 - abs * 0.09),
                    opacity: Math.max(0, 1 - abs * 0.32),
                  }}
                  transition={
                    dragging.current || reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 440, damping: 36 }
                  }
                  onClick={() => {
                    if (moved.current) return; // it was a drag, not a tap
                    if (isFocused) onOpen(p);
                    else setFocus(i);
                  }}
                >
                  <span className={`plc-card__cover${p.thumbnailUrl ? "" : " plc-card__cover--empty"}`}>
                    {p.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <Music size={20} />
                    )}
                  </span>
                  <span className="plc-card__meta">
                    <span className="plc-card__name" title={p.title}>
                      {p.title}
                    </span>
                    <span className="plc-card__count">
                      {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </div>
          <p className="plc__pos faint">
            {nearest + 1} / {filtered.length}
          </p>
        </>
      )}
    </div>
  );
}
