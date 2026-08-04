"use client";

import { useEffect, useRef, useState } from "react";
import { getTrackLyrics } from "@/src/lib/room/lyrics";
import { playbackProgress } from "@/src/lib/room/progress";
import { activeLineIndex, lineProgress, parseLrc, wordSpans, type LyricLine } from "@/src/lyrics/lrc";
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
 * up as they pass. Position comes from the room's shared clock — the same
 * source the progress bar uses — so every listener sees the same word lit at
 * the same moment, whether or not their device is the one making sound.
 */
export function Lyrics({
  nowPlaying,
  offset,
}: {
  nowPlaying: RoomNowPlaying;
  offset: number;
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
    // pretending to be in time with it.
    return <p className="lyrics lyrics--plain">{state.text.split(/\r?\n/).slice(0, 2).join(" · ")}</p>;
  }

  const { position } = playbackProgress(now, offset, nowPlaying);
  const index = activeLineIndex(state.lines, position);
  const line = state.lines[index];

  // Before the first line, and through instrumental gaps, the window is empty
  // on purpose — a stale line hanging over an instrumental reads as broken.
  if (!line || line.text === "") return <p className="lyrics lyrics--quiet" aria-hidden />;

  const progress = lineProgress(state.lines, index, position, nowPlaying.durationMs);

  return (
    <p className="lyrics" key={index} aria-live="off">
      {wordSpans(line.text).map((span, i) => (
        <span
          key={`${index}:${i}`}
          // The leading space is real text, not a CSS ::before: generated
          // content is invisible to copy-paste and to a screen reader, which
          // would turn the line into one run-on word.
          className={progress >= span.end ? "lyrics__word lyrics__word--sung" : "lyrics__word"}
          // The word being sung fades up across its own span instead of
          // snapping on, which is what makes the highlight look like it's
          // moving with the voice.
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
  );
}
