import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALM,
  EDGES,
  LIVE,
  edgeSeed,
  squigglePoints,
  squiggleUrl,
  type Edge,
} from "../../src/visual/squiggle";
import { wobbleAt } from "../../src/visual/starfield";

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The value of a `--token: ...;` declaration, wherever it is declared. */
function token(name: string): string | null {
  const m = CSS.match(new RegExp(`^\\s*${name}:\\s*(.+?);\\s*$`, "m"));
  return m?.[1] ?? null;
}

/** The rules that actually draw, found by what they do rather than by a class
 *  name — the frame is attached to the surfaces june already had. */
function rulesUsing(needle: RegExp): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const [, selector, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selector && body && needle.test(body)) out.push({ selector: selector.trim(), body });
  }
  return out;
}

function frameRule(): { selector: string; body: string } {
  const [rule] = rulesUsing(/mask-image:\s*var\(--squiggle-top/);
  expect(rule).toBeDefined();
  return rule!;
}

describe("the pen", () => {
  it("draws with the same wobble as the notation, not its own copy", () => {
    // The whole point of the exercise: a border and a staff line come off the
    // same nib. If this ever diverges, the frames stop matching the field
    // behind them and the trick is over.
    const pts = squigglePoints(CALM, 1);
    const mid = pts[Math.floor(pts.length / 2)]!;
    const t = mid.x / CALM.length;
    const expected =
      CALM.band / 2 + wobbleAt(1, t * CALM.span) * CALM.amount * Math.sin(t * Math.PI);
    expect(mid.y).toBeCloseTo(expected, 10);
  });

  it("pins both ends, so four edges meet at the corners", () => {
    for (const seed of [1, 7.5, 90.25]) {
      const pts = squigglePoints(CALM, seed);
      expect(pts[0]!.y).toBeCloseTo(CALM.band / 2, 10);
      expect(pts[pts.length - 1]!.y).toBeCloseTo(CALM.band / 2, 10);
    }
  });

  it("spans the full edge, end to end", () => {
    const pts = squigglePoints(CALM, 3);
    expect(pts[0]!.x).toBe(0);
    expect(pts[pts.length - 1]!.x).toBe(CALM.length);
  });

  it("wanders in the middle — a pinned line that never moves is just a line", () => {
    const pts = squigglePoints(CALM, 3);
    const spread = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(spread).toBeGreaterThan(CALM.amount);
  });

  it("keeps the whole stroke inside its band, so nothing is clipped away", () => {
    for (const style of [CALM, LIVE]) {
      for (const edge of EDGES) {
        for (const p of squigglePoints(style, edgeSeed(style, edge))) {
          expect(p.y).toBeGreaterThanOrEqual(style.weight / 2);
          expect(p.y).toBeLessThanOrEqual(style.band - style.weight / 2);
        }
      }
    }
  });

  it("draws the same line every time — a border that redraws itself shimmers", () => {
    expect(squigglePoints(CALM, 12)).toEqual(squigglePoints(CALM, 12));
  });

  it("gives every edge its own hand, so opposite sides do not mirror", () => {
    const seeds = EDGES.map((e) => edgeSeed(CALM, e));
    expect(new Set(seeds).size).toBe(EDGES.length);
    const top = squigglePoints(CALM, edgeSeed(CALM, "top"));
    const bottom = squigglePoints(CALM, edgeSeed(CALM, "bottom"));
    expect(top).not.toEqual(bottom);
  });

  it("presses harder for the live accent — denser, and only denser", () => {
    // Chanel's rule, enforced: the accent may differ from the calm stroke in
    // exactly one property. Every knob that is not `span` has to match, or the
    // accent has quietly become a second design.
    expect(LIVE.span).toBeGreaterThan(CALM.span);
    expect(LIVE.amount).toBe(CALM.amount);
    expect(LIVE.band).toBe(CALM.band);
    expect(LIVE.weight).toBe(CALM.weight);
    expect(LIVE.length).toBe(CALM.length);
  });
});

describe("the data URI", () => {
  it("survives being pasted into a CSS url()", () => {
    const uri = squiggleUrl(CALM, "top");
    expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true);
    // Anything that would close the url() early or start a CSS comment.
    const inner = uri.slice('url("'.length, -'")'.length);
    expect(inner).not.toMatch(/[<>#"']/);
  });

  it("carries no palette of its own — the token behind the mask paints it", () => {
    // The stencil is alpha only: `black` there means "reveal", not a colour
    // decision. A hex or an rgb() would be a theme token copied into an image,
    // which is a border that stops answering to the theme.
    expect(squiggleUrl(CALM, "top")).not.toMatch(/%23|#[0-9a-f]{3}|rgb|hsl/i);
  });

  it("turns the vertical edges on their side rather than reusing the flat one", () => {
    expect(squiggleUrl(CALM, "left")).not.toBe(squiggleUrl(CALM, "top"));
    // A vertical tile is tall and narrow; a horizontal one is the reverse.
    expect(squiggleUrl(CALM, "left")).toContain(`width='${CALM.band}'`.replace(/'/g, "%27"));
  });
});

describe("the stylesheet", () => {
  it("holds exactly the strokes the pen draws", () => {
    // Closes the loop: the SVGs are baked into globals.css, so without this
    // the CSS and the generator can drift apart silently and nobody notices
    // until a border looks wrong.
    for (const edge of EDGES) {
      expect(token(`--squiggle-${edge}`)).toBe(squiggleUrl(CALM, edge));
      expect(token(`--squiggle-live-${edge}`)).toBe(squiggleUrl(LIVE, edge));
    }
  });

  it("frames the sheets, and leaves the windows alone", () => {
    // The restraint decision, written down. A sheet gets a drawn frame; a
    // toolbar and a scrollport do not. If someone later adds the rail or the
    // artwork here, the room grows a second drawn rectangle beside the player
    // card and the accent stops being an accent.
    const selectors = frameRule().selector;
    for (const framed of [".paper", ".container:not(.hero)", ".pl", ".room__center .stage"]) {
      expect(selectors).toContain(`${framed}::before`);
    }
    for (const left of [".audio-stage", ".room__rail", ".room__bar", ".topbar", ".btn", ".input"]) {
      expect(selectors).not.toContain(`${left}::before`);
    }
  });

  it("paints every stroke from a line token, never a literal", () => {
    for (const rule of rulesUsing(/mask-image:\s*var\(--squiggle/)) {
      const bg = rule.body.match(/^\s*background:\s*(.+?);/m);
      if (bg) expect(bg[1]).toMatch(/^var\(--(line|line-2|ink)\)$/);
    }
  });

  it("never lets a framed surface change size to make room for the stroke", () => {
    // The hard constraint, as a test. The stroke is an overlay; the 1px border
    // it stands in for keeps its width and only loses its colour. `border: 0`
    // or a `border-width` here would collapse every framed box by 2px and shift
    // everything inside it — the exact failure this whole approach exists to
    // avoid, and one that is invisible in a diff.
    for (const rule of rulesUsing(/mask-image:\s*var\(--squiggle/)) {
      expect(rule.body).not.toMatch(/^\s*(border|border-width|border-style|padding|margin)\s*:/m);
    }
    const neutralising = rulesUsing(/border-color:\s*transparent/);
    expect(neutralising.length).toBeGreaterThan(0);
    for (const rule of neutralising) {
      expect(rule.body).not.toMatch(/^\s*(border|border-width|border-style)\s*:/m);
    }
  });

  it("cancels the offset it inherits by needing to be positioned", () => {
    // A real bug this caught. The stage is `position: sticky; top: 1.5rem`,
    // and the wide breakpoint used to drop it back to `static`, where that
    // `top` is inert. A drawn frame needs a positioned ancestor, and switching
    // to `relative` makes the browser honour the stale offset — the card fell
    // 21px and took the whole player with it. Invisible in a screenshot, and
    // only ever found by measuring.
    const [rule] = rulesUsing(/position:\s*relative/).filter((r) =>
      r.selector.includes(".room__center .stage"),
    );
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/top:\s*auto/);
  });

  it("needs no second copy of itself for the other theme", () => {
    // The stencils are alpha, so the theme block never has to restate them.
    // A --squiggle-* inside [data-theme="light"] would mean a palette had
    // leaked into an image.
    const from = CSS.indexOf(':root[data-theme="light"]');
    const light = CSS.slice(from, CSS.indexOf("\n}", from));
    expect(light).toMatch(/--line-2:/); // the slice really is the theme block
    expect(light).not.toMatch(/--squiggle-/);
  });
});
