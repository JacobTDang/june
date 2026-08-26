/**
 * The vocabulary of the terminal UI: corner ticks, dot rules, ASCII checks,
 * a block cursor, a prompt. Small on purpose — each does one thing, and the
 * character of the interface comes from using them consistently rather than
 * from any one of them being clever.
 */

/** A corner bracket. Marks the extent of a region without drawing a full box,
 *  which would fight the paper it sits on. */
export function Tick({ corner = "tl" }: { corner?: "tl" | "tr" | "bl" | "br" }) {
  return <span className={`tick tick--${corner}`} aria-hidden />;
}

/** A rule whose dots thin out along its length. Reads as a divider, and
 *  rhymes with the dithered field behind the page. */
export function DotRule({ flip = false }: { flip?: boolean }) {
  return <span className={`dotrule${flip ? " dotrule--flip" : ""}`} aria-hidden />;
}

/** `[x]` / `[ ]`. A state you can read aloud. The brackets are decorative to a
 *  screen reader, which gets the real state from the checkbox semantics. */
export function AsciiCheck({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="acheck" role="img" aria-label={`${label}: ${checked ? "yes" : "no"}`}>
      <span aria-hidden>[{checked ? "x" : " "}]</span> {label}
    </span>
  );
}

/** A blinking block. Stops blinking under prefers-reduced-motion — a cursor
 *  that never rests is the kind of thing that makes a page hard to sit with. */
export function Cursor() {
  return (
    <>
      {" "}
      <b className="cursor" aria-hidden />
    </>
  );
}

/** The `>` that starts a line. Purely typographic, so it is hidden from
 *  assistive tech rather than read as punctuation on every heading. */
export function Prompt() {
  return (
    <>
      <span className="prompt" aria-hidden>
        &gt;
      </span>{" "}
    </>
  );
}
