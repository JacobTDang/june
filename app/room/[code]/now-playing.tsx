"use client";

import { useEffect, useState } from "react";
import { SkipForward } from "lucide-react";
import type { RoomNowPlaying } from "@/src/lib/room/types";
import { playbackProgress } from "@/src/lib/room/progress";

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
  // null until mounted, so the server render and the first client render agree
  // (both compute a deterministic position). The interval then drives live time.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const { position, pct } = playbackProgress(now, offset, nowPlaying);

  return (
    <div className="now">
      <div className="now__head">
        <div className="now__meta">
          <div className="now__title">{nowPlaying.title}</div>
          {nowPlaying.artist && <div className="muted">{nowPlaying.artist}</div>}
        </div>
        <button className="btn" onClick={onSkip}>
          <SkipForward size={16} />
          Skip
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
