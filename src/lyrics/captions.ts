/** Turning a video's caption track into lyric lines.
 *
 *  Captions beat a lyrics database on the one thing that matters here: they
 *  are timed against the exact upload being streamed. A database file is
 *  timed against *a* recording of the song, and transcriptions of the same
 *  song routinely disagree by a whole intro — so the words can be right and
 *  still land fifteen seconds out. What captions cost is tidiness: they also
 *  narrate the music, which is what this module strips. */

import type { LyricLine } from "./lrc";

export interface Cue {
  startMs: number;
  text: string;
}

/** Music notation and sound description, not words anyone sings. */
const NOTE_MARKS = /[♪♫🎵🎶]/g;
/** A whole cue that only describes the recording: "(gentle music)", "[Music]". */
const DESCRIPTION_ONLY = /^[([][^)\]]*[)\]]$/;

/**
 * Caption cues as lyric lines: notation stripped, sound descriptions dropped,
 * repeats collapsed. Returns [] when nothing is left worth showing, which the
 * caller treats as "this video has no usable captions" and falls back.
 */
export function captionsToLines(cues: readonly Cue[]): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const cue of [...cues].sort((a, b) => a.startMs - b.startMs)) {
    const text = cue.text
      .replace(NOTE_MARKS, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (text === "" || DESCRIPTION_ONLY.test(text)) continue;
    // Rolling captions re-emit a line as it builds; only the first arrival is
    // the moment it was sung.
    if (lines[lines.length - 1]?.text === text) continue;

    lines.push({ timeMs: cue.startMs, text });
  }

  return lines;
}
