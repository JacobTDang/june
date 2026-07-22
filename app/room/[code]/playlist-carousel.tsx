"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Music, RefreshCw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { playlistWindow } from "@/src/lib/room/playlist-window";

export type Playlist = {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl?: string | null;
};

const slide = {
  enter: (dir: number) => ({ x: dir >= 0 ? 44 : -44, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? -44 : 44, opacity: 0 }),
};

/** Browse playlists three at a time: a name filter plus paged, animated cards. */
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
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(0);
  const reduce = useReducedMotion() ?? false;

  const win = playlistWindow(playlists, query, page, 3);

  function go(delta: number) {
    setDir(delta);
    setPage(win.page + delta);
  }

  function onQuery(value: string) {
    setQuery(value);
    setPage(0);
    setDir(0);
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

      {win.total === 0 ? (
        <p className="muted plc__empty">No playlists match “{query}”.</p>
      ) : (
        <>
          <div className="plc__row">
            <button
              className="plc__arrow"
              onClick={() => go(-1)}
              disabled={win.page === 0}
              aria-label="Previous playlists"
            >
              <ChevronLeft size={18} />
            </button>

            <div className="plc__viewport">
              <AnimatePresence custom={dir} mode="wait" initial={false}>
                <motion.div
                  key={win.page}
                  className="plc__cards"
                  custom={dir}
                  variants={reduce ? undefined : slide}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                >
                  {win.cards.map((p) => (
                    <button
                      key={p.id}
                      className="plc__card"
                      onClick={() => onOpen(p)}
                      disabled={busy}
                    >
                      <span className={`plc__cover${p.thumbnailUrl ? "" : " plc__cover--empty"}`}>
                        {p.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnailUrl} alt="" loading="lazy" />
                        ) : (
                          <Music size={20} />
                        )}
                      </span>
                      <span className="plc__name" title={p.title}>
                        {p.title}
                      </span>
                      <span className="plc__count">
                        {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                      </span>
                    </button>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>

            <button
              className="plc__arrow"
              onClick={() => go(1)}
              disabled={win.page >= win.pageCount - 1}
              aria-label="More playlists"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {win.pageCount > 1 && (
            <div className="plc__dots" aria-hidden="true">
              {Array.from({ length: win.pageCount }, (_, i) => (
                <span key={i} className={`plc__dot${i === win.page ? " plc__dot--on" : ""}`} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
