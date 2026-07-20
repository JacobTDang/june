"use client";

import { useEffect, useState } from "react";
import type { RoomNowPlaying } from "@/src/lib/room/types";

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function NowPlaying({
  nowPlaying,
  offset,
  onSkip,
}: {
  nowPlaying: RoomNowPlaying;
  offset: number;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const position = Math.min(
    Math.max(0, now + offset - nowPlaying.startedAt),
    nowPlaying.durationMs,
  );
  const pct = nowPlaying.durationMs > 0 ? (position / nowPlaying.durationMs) * 100 : 0;

  return (
    <div className="now">
      <div className="now__head">
        <div className="now__meta">
          <div className="now__title">{nowPlaying.title}</div>
          {nowPlaying.artist && <div className="muted">{nowPlaying.artist}</div>}
        </div>
        <button className="btn" onClick={onSkip}>
          ⏭ Skip
        </button>
      </div>
      <div className="progress" aria-hidden>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="now__times muted">
        <span>{fmt(position)}</span>
        {nowPlaying.addedByName && <span>added by {nowPlaying.addedByName}</span>}
        <span>{fmt(nowPlaying.durationMs)}</span>
      </div>
    </div>
  );
}
