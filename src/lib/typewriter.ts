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
