/** How long each stage of a message lasts. */
export type TypewriterTiming = {
  /** Per character while revealing. */
  typeMs: number;
  /** Pause once the whole message is shown. */
  holdMs: number;
  /** Per character while removing. */
  deleteMs: number;
  /** Pause on an empty line before the next message starts. */
  gapMs: number;
};

export type TypewriterFrame = { text: string; index: number };

/** How long one message occupies, start to start. */
function cycleFor(message: string, t: TypewriterTiming): number {
  return message.length * t.typeMs + t.holdMs + message.length * t.deleteMs + t.gapMs;
}

/**
 * What the line reads at a given moment.
 *
 * A pure function of elapsed time rather than a stateful ticker: the component
 * can render from any clock, and the whole sequence is testable without
 * waiting for it. Each message owns a cycle sized to its own length, so a long
 * line does not compress the one after it.
 */
export function typewriterFrame(
  messages: readonly string[],
  elapsedMs: number,
  timing: TypewriterTiming,
): TypewriterFrame {
  if (messages.length === 0) return { text: "", index: 0 };

  const total = messages.reduce((sum, m) => sum + cycleFor(m, timing), 0);
  let at = ((elapsedMs % total) + total) % total;

  let index = 0;
  for (; index < messages.length; index++) {
    const cycle = cycleFor(messages[index]!, timing);
    if (at < cycle) break;
    at -= cycle;
  }

  const message = messages[Math.min(index, messages.length - 1)]!;
  const typing = message.length * timing.typeMs;
  const holding = typing + timing.holdMs;
  const deleting = holding + message.length * timing.deleteMs;

  // Clamped rather than trusted: a rounding error at a stage boundary would
  // slice past the end of the string and render one frame of nonsense.
  const clamp = (n: number) => Math.max(0, Math.min(message.length, n));

  if (at < typing) {
    return { text: message.slice(0, clamp(Math.floor(at / timing.typeMs))), index };
  }
  if (at < holding) return { text: message, index };
  if (at < deleting) {
    const removed = Math.floor((at - holding) / timing.deleteMs);
    return { text: message.slice(0, clamp(message.length - removed)), index };
  }
  return { text: "", index };
}

/** One run of the typed line, and whether it should be emphasised. */
export type Segment = { text: string; strong: boolean };

/** Below this many characters a trailing partial is just a letter, not a word
 *  arriving — bolding it would flicker on almost every message. */
const MIN_PARTIAL = 3;

/**
 * Split a line so occurrences of `term` can be set in bold.
 *
 * A trailing *incomplete* term counts too. The line is typed one character at
 * a time and the term sits at the end of these messages, so matching only
 * whole words would leave it plain until the final keystroke and then snap.
 * Short prefixes are left alone, or every message ending in "t" would flash.
 */
export function emphasise(text: string, term: string): Segment[] {
  if (text === "" || term === "") return text === "" ? [] : [{ text, strong: false }];

  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  const out: Segment[] = [];
  let at = 0;

  const push = (slice: string, strong: boolean) => {
    if (slice !== "") out.push({ text: slice, strong });
  };

  for (;;) {
    const found = haystack.indexOf(needle, at);
    if (found === -1) break;
    push(text.slice(at, found), false);
    push(text.slice(found, found + term.length), true);
    at = found + term.length;
  }

  const tail = text.slice(at);
  // The growing edge: the longest suffix of what is typed that is also a
  // prefix of the term.
  for (let len = Math.min(tail.length, term.length - 1); len >= MIN_PARTIAL; len--) {
    if (tail.slice(-len).toLowerCase() === needle.slice(0, len)) {
      push(tail.slice(0, tail.length - len), false);
      push(tail.slice(-len), true);
      return out;
    }
  }
  push(tail, false);
  return out;
}
