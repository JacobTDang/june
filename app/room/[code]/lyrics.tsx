"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { getTrackLyrics } from "@/src/lib/room/lyrics";
import { playbackProgress } from "@/src/lib/room/progress";
import { activeLineIndex, parseLrc, type LyricLine } from "@/src/lyrics/lrc";
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
  const videoId = nowPlaying.videoId;
  // Guards against a slow fetch for the previous track landing after the room
  // has moved on and painting the wrong song's words.
  const wanted = useRef(videoId);

  useEffect(() => {
    wanted.current = videoId;
    setState({ kind: "loading" });

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
  const position = playingHere
    ? audio.currentTime * 1000
    : playbackProgress(now, offset, nowPlaying).position;

  const index = activeLineIndex(state.lines, position);
  const line = state.lines[index];

  return (
    <div className="lyrics-box">
      {/* Before the first line, and through instrumental gaps, the window is
          empty on purpose — a stale line hanging over an instrumental reads
          as broken. */}
      {!line || line.text === "" ? (
        <p className="lyrics lyrics--quiet" aria-hidden />
      ) : (
        <p className="lyrics" key={index} dir="auto" aria-live="off">
          {line.text}
        </p>
      )}

    </div>
  );
}
