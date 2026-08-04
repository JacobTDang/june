"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Minus, Plus } from "lucide-react";
import { getTrackLyrics } from "@/src/lib/room/lyrics";
import { playbackProgress } from "@/src/lib/room/progress";
import {
  activeLineIndex,
  lineProgress,
  parseLrc,
  wordSpans,
  type LyricLine,
} from "@/src/lyrics/lrc";
import { NUDGE_STEP_MS, clampNudge, nudgeKey, readNudge } from "@/src/lyrics/nudge";
import type { RoomNowPlaying } from "@/src/lib/room/types";

/** Fast enough that the highlight slides rather than steps, slow enough to
 *  stay off the animation frame budget the visualizer is already using. */
const TICK_MS = 80;

type State =
  | { kind: "loading" }
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; text: string }
  | { kind: "none" };

/**
 * The current line of the song, one line at a time, with the words lighting
 * up as they pass.
 *
 * Position comes from this device's own audio element whenever it's the one
 * playing, and from the room's shared clock otherwise. That distinction is
 * the difference between lyrics that feel locked to the music and lyrics that
 * sit a beat off: the player tolerates up to ~1.2s of drift from the shared
 * clock before correcting, and reading the room's clock inherits every bit of
 * it. A silent device has no element to read, so it follows the room — which
 * is right, since it isn't hearing anything to be out of step with.
 */
export function Lyrics({
  nowPlaying,
  offset,
  audioRef,
  silent,
}: {
  nowPlaying: RoomNowPlaying;
  offset: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  silent: boolean;
}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState<number | null>(null);
  const [nudgeMs, setNudgeMs] = useState(0);
  const videoId = nowPlaying.videoId;
  // Guards against a slow fetch for the previous track landing after the room
  // has moved on and painting the wrong song's words.
  const wanted = useRef(videoId);

  useEffect(() => {
    wanted.current = videoId;
    setState({ kind: "loading" });
    try {
      setNudgeMs(readNudge(window.localStorage.getItem(nudgeKey(videoId))));
    } catch {
      setNudgeMs(0);
    }

    void getTrackLyrics({
      videoId,
      title: nowPlaying.title,
      artist: nowPlaying.artist ?? null,
      durationMs: nowPlaying.durationMs,
    })
      .then((lyrics) => {
        if (wanted.current !== videoId) return;
        const lines = lyrics.syncedLyrics ? parseLrc(lyrics.syncedLyrics) : [];
        if (lines.length > 0) setState({ kind: "synced", lines });
        else if (lyrics.plainLyrics) setState({ kind: "plain", text: lyrics.plainLyrics });
        else setState({ kind: "none" });
      })
      .catch(() => {
        if (wanted.current === videoId) setState({ kind: "none" });
      });
  }, [videoId, nowPlaying.title, nowPlaying.artist, nowPlaying.durationMs]);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  function nudge(deltaMs: number) {
    const next = clampNudge(nudgeMs + deltaMs);
    setNudgeMs(next);
    try {
      window.localStorage.setItem(nudgeKey(videoId), String(next));
    } catch {
      // Storage unavailable: the correction still holds for this session.
    }
  }

  if (state.kind === "loading") return <p className="lyrics lyrics--quiet">Finding the words…</p>;
  if (state.kind === "none") return <p className="lyrics lyrics--quiet">No lyrics for this one.</p>;
  if (state.kind === "plain") {
    // Nothing to follow along to, so show the song's opening rather than
    // pretending to be in time with it. dir="auto" because these words are as
    // likely to be Arabic or Hebrew as English.
    return (
      <p className="lyrics lyrics--plain" dir="auto">
        {state.text.split(/\r?\n/).slice(0, 2).join(" · ")}
      </p>
    );
  }

  const audio = audioRef.current;
  // The element's own clock when this device is playing: it is what the
  // listener is actually hearing. Anything else (muted, buffering, no
  // metadata yet) falls back to the room's shared position.
  const playingHere =
    !silent &&
    audio !== null &&
    !audio.paused &&
    audio.readyState >= HTMLMediaElement.HAVE_METADATA &&
    audio.currentTime > 0;
  const position =
    (playingHere ? audio.currentTime * 1000 : playbackProgress(now, offset, nowPlaying).position) +
    nudgeMs;

  const index = activeLineIndex(state.lines, position);
  const line = state.lines[index];
  const progress = line ? lineProgress(state.lines, index, position, nowPlaying.durationMs) : 0;

  return (
    <div className="lyrics-box">
      {/* Before the first line, and through instrumental gaps, the window is
          empty on purpose — a stale line hanging over an instrumental reads
          as broken. */}
      {!line || line.text === "" ? (
        <p className="lyrics lyrics--quiet" aria-hidden />
      ) : (
        <p className="lyrics" key={index} dir="auto" aria-live="off">
          {wordSpans(line.text).map((span, i) => (
            <span
              key={`${index}:${i}`}
              // The leading space is real text, not a CSS ::before: generated
              // content is invisible to copy-paste and to a screen reader,
              // which would turn the line into one run-on word.
              className={progress >= span.end ? "lyrics__word lyrics__word--sung" : "lyrics__word"}
              style={
                progress > span.start && progress < span.end
                  ? { opacity: 0.55 + 0.45 * ((progress - span.start) / (span.end - span.start)) }
                  : undefined
              }
            >
              {i > 0 ? ` ${span.word}` : span.word}
            </span>
          ))}
        </p>
      )}

      {/* Some uploads simply aren't the recording the file was timed against —
          a longer intro, a different master. This is the cure for that, and
          it's remembered per track on this device. */}
      <div className="lyrics__nudge">
        <button onClick={() => nudge(-NUDGE_STEP_MS)} aria-label="Lyrics earlier" title="Earlier">
          <Minus size={12} />
        </button>
        <span className={nudgeMs === 0 ? "lyrics__nudge-value" : "lyrics__nudge-value is-set"}>
          {nudgeMs === 0 ? "sync" : `${nudgeMs > 0 ? "+" : ""}${(nudgeMs / 1000).toFixed(1)}s`}
        </span>
        <button onClick={() => nudge(NUDGE_STEP_MS)} aria-label="Lyrics later" title="Later">
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
