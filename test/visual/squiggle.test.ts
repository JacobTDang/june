import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CALM,
  EDGES,
  LIVE,
  acrossAt,
  edgeSeed,
  edgeStyle,
  inkAt,
  pressureAt,
  squigglePoints,
  squiggleRuns,
  squiggleUrl,
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

/** Every style actually used to draw, edge character included. */
const DRAWN = EDGES.flatMap((edge) =>
  [CALM, LIVE].map((style) => ({ edge, style: edgeStyle(style, edge), seed: edgeSeed(style, edge) })),
);

function samples(n = 400): number[] {
  return Array.from({ length: n + 1 }, (_, i) => i / n);
}

/** How many times a signal changes direction. Turning points rather than zero
 *  crossings: a large slow drift holds the ripple off the axis entirely, so
 *  counting sign-of-value would miss the tremble riding on top of it — which
 *  is the very thing these tests are here to prove is present. */
function turns(values: number[]): number {
  let n = 0;
  for (let i = 2; i < values.length; i++) {
    const a = values[i - 1]! - values[i - 2]!;
    const b = values[i]! - values[i - 1]!;
    if (Math.sign(a) !== Math.sign(b)) n++;
  }
  return n;
}

describe("the pen", () => {
  it("draws with the same wobble as the notation, not its own copy", () => {
    // The whole point of the exercise: a border and a staff line come off the
    // same nib. If this ever diverges, the frames stop matching the field
    // behind them and the trick is over.
    const t = 0.42;
    const ripple = wobbleAt(1, t * CALM.span);
    const drift = wobbleAt(1 * CALM.driftSeed + CALM.driftPhase, t * CALM.span * CALM.driftRate);
    const expected =
      (ripple * (1 - CALM.drift) + drift * CALM.drift) * CALM.amount * Math.sin(t * Math.PI);
    expect(acrossAt(CALM, 1, t)).toBeCloseTo(expected, 10);
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

  it("draws the same line every time — a border that redraws itself shimmers", () => {
    expect(squiggleRuns(CALM, 12)).toEqual(squiggleRuns(CALM, 12));
  });

  it("keeps the whole stroke inside its band, so nothing is clipped away", () => {
    // Now that the line has width of its own, containment is about the ribbon's
    // edges, not its centre. This is the test that stops a heavier stroke from
    // being sliced flat by the mask.
    for (const { style, seed } of DRAWN) {
      for (const run of squiggleRuns(style, seed)) {
        for (const p of run) {
          expect(p.across + p.half).toBeLessThanOrEqual(style.band / 2);
          expect(p.across - p.half).toBeGreaterThanOrEqual(-style.band / 2);
        }
      }
    }
  });
});

describe("pressure", () => {
  it("presses hardest through the middle of the pull and lifts at the ends", () => {
    for (const { style, seed } of DRAWN) {
      const mid = samples(60).slice(20, 41).map((t) => pressureAt(style, seed, t));
      const ends = [pressureAt(style, seed, 0), pressureAt(style, seed, 1)];
      const meanMid = mid.reduce((a, b) => a + b, 0) / mid.length;
      expect(meanMid).toBeGreaterThan(Math.max(...ends));
    }
  });

  it("never lifts the pen clean off — a stroke that vanishes is a gap, not a taper", () => {
    for (const { style, seed } of DRAWN) {
      for (const t of samples()) expect(pressureAt(style, seed, t)).toBeGreaterThan(0.2);
    }
  });

  it("varies along the stroke rather than holding one weight", () => {
    // The failure this guards: a perfectly even line reads as wobbly, not drawn.
    for (const { style, seed } of DRAWN) {
      const w = samples(200).map((t) => pressureAt(style, seed, t));
      expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.25);
    }
  });

  it("runs on its own noise, independent of the sideways wobble", () => {
    // Weight and wander are two different things a hand does. If pressure were
    // derived from the same term as the wobble, every bulge would sit on every
    // bend and the stroke would read as one mechanism, not two.
    const faster = { ...CALM, span: CALM.span * 4 };
    for (const t of samples(50)) {
      expect(pressureAt(faster, 5, t)).toBeCloseTo(pressureAt(CALM, 5, t), 12);
      // Skip the pinned ends, where the taper zeroes both and there is nothing
      // to compare.
      if (t > 0.05 && t < 0.95) {
        expect(acrossAt(faster, 5, t)).not.toBeCloseTo(acrossAt(CALM, 5, t), 6);
      }
    }
  });
});

describe("breaks", () => {
  it("always has the pen down at the corners", () => {
    // A gap at a corner reads as a broken box rather than a drawn one, so the
    // ends are never allowed to skip however the noise falls.
    for (const { style, seed } of DRAWN) {
      expect(inkAt(style, seed, 0)).toBe(true);
      expect(inkAt(style, seed, 1)).toBe(true);
      const runs = squiggleRuns(style, seed);
      expect(runs[0]![0]!.along).toBe(0);
      const last = runs[runs.length - 1]!;
      expect(last[last.length - 1]!.along).toBe(style.length);
    }
  });

  it("skips a few times per edge — grain, not a dashed line", () => {
    // Restraint, as a number. One or two skips read as paper texture; a dozen
    // reads as a dashed border, which is a different design entirely.
    for (const { style, seed } of DRAWN) {
      const gaps = squiggleRuns(style, seed).length - 1;
      expect(gaps).toBeGreaterThanOrEqual(1);
      expect(gaps).toBeLessThanOrEqual(5);
    }
  });

  it("keeps every skip short", () => {
    for (const { style, seed } of DRAWN) {
      const runs = squiggleRuns(style, seed);
      for (let i = 1; i < runs.length; i++) {
        const prev = runs[i - 1]!;
        const gap = runs[i]![0]!.along - prev[prev.length - 1]!.along;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(style.length * 0.06);
      }
    }
  });

  it("skips where the pen is light, the way graphite misses paper", () => {
    // The two effects are coupled on purpose: breaks land in the thin passages,
    // so weight and grain read as one hand rather than two filters.
    for (const { style, seed } of DRAWN) {
      const ts = samples(300).filter((t) => t > 0.1 && t < 0.9);
      const lifted = ts.filter((t) => !inkAt(style, seed, t));
      if (!lifted.length) continue;
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      const liftedPressure = mean(lifted.map((t) => pressureAt(style, seed, t)));
      const allPressure = mean(ts.map((t) => pressureAt(style, seed, t)));
      expect(liftedPressure).toBeLessThan(allPressure);
    }
  });
});

describe("the four edges", () => {
  it("gives every edge its own hand, so opposite sides do not mirror", () => {
    const seeds = EDGES.map((e) => edgeSeed(CALM, e));
    expect(new Set(seeds).size).toBe(EDGES.length);
  });

  it("varies their character, not just their phase", () => {
    // Four rotations of one curve is a machine repeating itself. A person
    // drawing a box draws four different lines.
    const styles = EDGES.map((e) => edgeStyle(CALM, e));
    for (const key of ["amount", "span", "pressureSwing"] as const) {
      expect(new Set(styles.map((s) => s[key])).size).toBe(EDGES.length);
    }
  });

  it("still keeps all four recognisably the same pen", () => {
    // The other failure mode: vary them so much that the box looks assembled
    // from four unrelated scraps.
    const styles = EDGES.map((s) => edgeStyle(CALM, s));
    for (const key of ["amount", "span"] as const) {
      const vals = styles.map((s) => s[key]);
      expect(Math.max(...vals) / Math.min(...vals)).toBeLessThan(1.8);
    }
  });
});

describe("the wander", () => {
  it("wanders as well as ripples — two scales, not one", () => {
    // wobbleAt alone is smooth by construction. A slow, larger drift under the
    // ripple is what makes the deviation lumpy rather than even.
    for (const { style, seed } of DRAWN) {
      const raw = samples().map((t) => acrossAt(style, seed, t));
      const slow = samples().map(
        (t) => wobbleAt(seed * style.driftSeed + style.driftPhase, t * style.span * style.driftRate),
      );
      expect(turns(slow)).toBeGreaterThanOrEqual(1);
      expect(turns(raw)).toBeGreaterThan(turns(slow) * 2);
    }
  });

  it("spends most of the travel gentle and only occasionally swings wide", () => {
    for (const { style, seed } of DRAWN) {
      const mags = samples().map((t) => Math.abs(acrossAt(style, seed, t)));
      const peak = Math.max(...mags);
      const mean = mags.reduce((a, b) => a + b, 0) / mags.length;
      expect(mean).toBeLessThan(peak * 0.62);
    }
  });
});

describe("the live accent", () => {
  it("presses harder for the live accent — denser, and only denser", () => {
    // Chanel's rule, enforced: the accent may differ from the calm stroke in
    // exactly one property. Every knob that is not `span` has to match, or the
    // accent has quietly become a second design.
    expect(LIVE.span).toBeGreaterThan(CALM.span);
    for (const key of Object.keys(CALM) as (keyof typeof CALM)[]) {
      if (key !== "span") expect(LIVE[key]).toBe(CALM[key]);
    }
  });
});

describe("the data URI", () => {
  it("survives being pasted into a CSS url()", () => {
    const uri = squiggleUrl(CALM, "top");
    expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true);
    const inner = uri.slice('url("'.length, -'")'.length);
    expect(inner).not.toMatch(/[<>#"']/);
  });

  it("carries no palette of its own — the token behind the mask paints it", () => {
    // The stencil is alpha only: `black` there means "reveal", not a colour
    // decision. A hex or an rgb() would be a theme token copied into an image,
    // which is a border that stops answering to the theme.
    expect(squiggleUrl(CALM, "top")).not.toMatch(/%23|#[0-9a-f]{3}|rgb|hsl/i);
  });

  it("draws the varying weight as a filled ribbon, not a stroked line", () => {
    // stroke-width is one number for a whole path, so a stroked line can only
    // ever be even. The outline is the width.
    const svg = squiggleUrl(CALM, "top");
    expect(svg).toContain("fill=%27black%27");
    expect(svg).not.toContain("stroke-width");
  });

  it("turns the vertical edges on their side rather than reusing the flat one", () => {
    expect(squiggleUrl(CALM, "left")).not.toBe(squiggleUrl(CALM, "top"));
    expect(squiggleUrl(CALM, "left")).toContain(`width='${CALM.band}'`.replace(/'/g, "%27"));
  });

  it("stays small enough to live in a stylesheet", () => {
    for (const edge of EDGES) expect(squiggleUrl(CALM, edge).length).toBeLessThan(6000);
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

  it("keeps the band and its slack on the space scale", () => {
    // The overlay's geometry is unchanged by any of the pen's variety — that
    // is what keeps the no-movement guarantee independent of how the stroke is
    // drawn. If the band ever grows, the inset has to grow with it.
    const body = frameRule().body;
    expect(body).toMatch(/inset:\s*calc\(var\(--space-1\) \* -1\)/);
    expect(body).toMatch(/var\(--space-2\)/);
  });
});
