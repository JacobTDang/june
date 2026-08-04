/** LRC parsing and the arithmetic that turns a playback position into "which
 *  line, and how far through it". Pure — the room's shared clock supplies the
 *  position, so every listener lands on the same word at the same moment. */

export interface LyricLine {
  /** Offset from the start of the track, in ms. */
  timeMs: number;
  /** The line itself. Empty means an instrumental gap: show nothing. */
  text: string;
}

export interface WordSpan {
  word: string;
  /** Fraction of the line elapsed when this word starts / ends (0–1). */
  start: number;
  end: number;
}

/** `[mm:ss]` or `[mm:ss.xx]`, possibly several before one line of text. */
const TIMESTAMP = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** `[offset:+250]` — the transcriber's own correction for a file that runs
 *  early or late against the recording, in milliseconds. */
const OFFSET_TAG = /\[offset:\s*([+-]?\d+)\s*\]/i;

/**
 * Parse an LRC file into lines ordered by time. Metadata tags (`[ar:…]`,
 * `[length:…]`) and untimed text are dropped: without a timestamp there is
 * nothing to sync to.
 */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  // Positive shifts the lyrics later, matching the tag's usual reading.
  const offsetMs = Number(OFFSET_TAG.exec(raw)?.[1] ?? 0);
  const shift = Number.isFinite(offsetMs) ? offsetMs : 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let end = 0;

    while ((match = TIMESTAMP.exec(rawLine)) !== null) {
      // Only leading timestamps count; one appearing mid-lyric is just text.
      if (match.index !== end) break;
      end = match.index + match[0].length;
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      // Two digits mean centiseconds, three mean milliseconds.
      const fraction = match[3] ?? "";
      const fractionMs =
        fraction === "" ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));
      stamps.push(minutes * 60_000 + seconds * 1_000 + fractionMs);
    }

    if (stamps.length === 0) continue;
    const text = rawLine.slice(end).trim();
    for (const timeMs of stamps) lines.push({ timeMs: Math.max(0, timeMs + shift), text });
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Index of the line that should be on screen at `positionMs`, or -1 when the
 * track hasn't reached the first line yet (intros, count-ins).
 */
export function activeLineIndex(lines: readonly LyricLine[], positionMs: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.timeMs > positionMs) break;
    index = i;
  }
  return index;
}

/**
 * How far through the current line the track is, 0–1. The line's span runs to
 * the next line's timestamp, or to the end of the track for the last line.
 */
export function lineProgress(
  lines: readonly LyricLine[],
  index: number,
  positionMs: number,
  trackDurationMs: number,
): number {
  const line = lines[index];
  if (!line) return 0;

  const start = line.timeMs;
  const end = lines[index + 1]?.timeMs ?? Math.max(trackDurationMs, start + 1);
  if (end <= start) return 1;

  return Math.min(1, Math.max(0, (positionMs - start) / (end - start)));
}

/**
 * Split a line into words with the fraction of the line each occupies.
 *
 * LRC timing is per line, not per word, so these are interpolated: each word
 * gets a share of the line proportional to its length. It isn't real word
 * timing and can't be — but it tracks how a line is sung much more closely
 * than dividing the time evenly, and it keeps the highlight moving smoothly
 * instead of jumping a whole line at a time.
 */
export function wordSpans(text: string): WordSpan[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const total = words.reduce((sum, w) => sum + w.length, 0);
  const spans: WordSpan[] = [];
  let elapsed = 0;

  for (const word of words) {
    const start = elapsed / total;
    elapsed += word.length;
    spans.push({ word, start, end: elapsed / total });
  }

  // Guard the last edge against floating-point drift: the caller compares
  // progress against `end`, and 0.9999999 would leave the final word unlit.
  spans[spans.length - 1]!.end = 1;
  return spans;
}
