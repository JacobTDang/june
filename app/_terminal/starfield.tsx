"use client";

import { useEffect, useRef } from "react";
import { withAlpha } from "@/src/visual/palette";
import { isRevealing } from "@/src/lib/reveal";
import {
  isSpent,
  makeStars,
  makeStaves,
  sparkleShape,
  spawnAsteroid,
  starBrightness,
  starHand,
  stepAsteroid,
  wobbleAt,
  type Asteroid,
  type SparkleShape,
  type Star,
  type Stave,
} from "@/src/visual/starfield";

/** Stars per million pixels — density, so a laptop and a big display look the
 *  same rather than one looking empty. */
const DENSITY = 190;
const MAX_STARS = 700;
/** Mean gap between asteroids. Rare enough to feel like an event. */
const ASTEROID_EVERY_MS = 5200;

/**
 * Lay a sparkle down on the canvas.
 *
 * The shape itself — uneven arms, an off-centre waist — is `sparkleShape`'s
 * job, and comes out of the same `wobbleAt` that makes a staff line look drawn
 * with a pen. All this does is walk it: start at a point, then pinch in at each
 * waist and back out to the next point.
 */
function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  shape: SparkleShape,
  r: number,
  outlined: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(x + shape.start.x, y + shape.start.y);
  for (const { waist, tip } of shape.sides) {
    ctx.quadraticCurveTo(x + waist.x, y + waist.y, x + tip.x, y + tip.y);
  }
  ctx.closePath();
  if (outlined && r > 3) {
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.fill();
  }
}

/**
 * A line drawn the way a hand draws it: never quite straight, thicker in the
 * middle of a stroke than at its ends.
 *
 * Sampled into segments with a smooth perpendicular drift rather than random
 * jitter per point — random jitter looks like a bad signal, drift looks like a
 * wrist.
 */
function inkLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amount = 1.1,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(6, Math.round(len / 14));
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Pinned at both ends: a line that wanders at its endpoints looks broken
    // rather than drawn.
    const taper = Math.sin(t * Math.PI);
    const off = wobbleAt(seed, t) * amount * taper;
    const px = x1 + dx * t + nx * off;
    const py = y1 + dy * t + ny * off;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

/** One fragment of staff with notes on it, drawn by hand. */
function drawStave(ctx: CanvasRenderingContext2D, s: Stave) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.tilt);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.lineWidth = 0.9;
  for (let line = -2; line <= 2; line++) {
    inkLine(ctx, 0, line * s.spacing, s.width, line * s.spacing, s.seed + line * 7.3, 1.2);
  }

  for (const note of s.notes) {
    const nx = note.at * s.width;
    const ny = (note.step / 2) * s.spacing;
    // Ledger line for a note sitting off the staff.
    if (Math.abs(note.step / 2) > 2.2) {
      ctx.lineWidth = 0.9;
      const at = Math.sign(note.step) * 3 * s.spacing;
      inkLine(ctx, nx - s.spacing, at, nx + s.spacing, at, s.seed + note.at * 31, 0.8);
    }
    // Head: an oval on a slant, the way a nib lays it down.
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(-0.34);
    ctx.beginPath();
    ctx.ellipse(0, 0, s.spacing * 0.72, s.spacing * 0.52, 0, 0, Math.PI * 2);
    if (note.open) {
      ctx.lineWidth = 1.1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
    ctx.restore();
    // Stem: up on the low notes, down on the high ones, as notation does.
    ctx.lineWidth = 1;
    const up = note.step > 0;
    const sx = nx + (up ? s.spacing * 0.66 : -s.spacing * 0.66);
    inkLine(ctx, sx, ny, sx, ny + (up ? -1 : 1) * s.spacing * 3.2, s.seed + note.at * 53, 0.7);
  }
  ctx.restore();
}

/**
 * The sky behind the app: stars that twinkle, and the occasional asteroid.
 *
 * Drawn as hard dots with no anti-aliasing on the stars, so it belongs to the
 * same one-bit world as the rest of the interface rather than looking like a
 * glossy screensaver.
 *
 * Under prefers-reduced-motion the field is painted once and left alone — the
 * stars are still there, they simply stop moving.
 */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Canvas cannot use a CSS variable, so the field reads the same two
    // tokens the rest of the page is painted from rather than keeping its
    // own copy of the palette. Re-read on theme change, not per frame.
    let paper = "#f4f3ee";
    let ink = "#111111";
    function readPalette() {
      const cs = getComputedStyle(document.documentElement);
      paper = cs.getPropertyValue("--bg").trim() || paper;
      ink = cs.getPropertyValue("--ink").trim() || ink;
    }
    readPalette();
    const themeWatch = new MutationObserver(() => {
      readPalette();
      // Repaint now, not on the next frame. The theme swap happens inside a
      // View Transition callback, and the browser snapshots the page right
      // after it - a canvas still holding last theme's colours would be
      // caught in that snapshot and flip only once the reveal finished.
      // draw() schedules the next frame itself, so drop the pending one to
      // avoid running two loops.
      cancelAnimationFrame(raf);
      draw(performance.now(), true);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    let stars: Star[] = [];
    let staves: Stave[] = [];
    let asteroids: Asteroid[] = [];
    let nextAsteroid = ASTEROID_EVERY_MS;
    let raf = 0;
    let last = 0;
    let started = 0;

    function size() {
      const c = ref.current;
      if (!c) return;
      // 1:1 with CSS pixels: these are hard dots, and scaling a hard dot is
      // how the dithered field ended up torn.
      const w = Math.max(1, Math.round(c.clientWidth));
      const h = Math.max(1, Math.round(c.clientHeight));
      if (c.width === w && c.height === h) return;
      c.width = w;
      c.height = h;
      stars = makeStars(Math.min(MAX_STARS, Math.round((w * h) / 1e6 * DENSITY)), w, h, Math.random);
      // A ceiling, not a quota: placement drops any stave that cannot find clear
      // space, so this asks and takes what lands. Kept sparse on purpose — the
      // notation is texture behind the app, and at this spacing nearly every
      // fragment finds room, so what is asked for is close to what is drawn.
      staves = makeStaves(Math.max(13, Math.round((w * h) / 36000)), w, h, Math.random);
    }

    /** `force` paints even mid-reveal: the theme-change repaint below has to
     *  land before the browser snapshots the page, or the revealed half shows
     *  the old palette. Everything else yields - see isRevealing. */
    function draw(now: number, force = false) {
      const c = ref.current;
      if (!c || !ctx) return;
      if (!force && isRevealing()) {
        if (!reduced) raf = requestAnimationFrame(draw);
        return;
      }
      const dt = last === 0 ? 16 : Math.min(now - last, 64);
      last = now;
      if (started === 0) started = now;
      const elapsed = now - started;

      // Ink on paper, whichever way round the theme has them.
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, c.width, c.height);

      // Notation sits behind the stars, and lighter: it is texture the eye
      // should find rather than read.
      ctx.fillStyle = withAlpha(ink, 0.34);
      ctx.strokeStyle = withAlpha(ink, 0.34);
      for (const stave of staves) drawStave(ctx, stave);

      ctx.fillStyle = ink;
      ctx.strokeStyle = ink;
      for (const star of stars) {
        // Brightness drives *size*, not opacity. On a one-bit page a star
        // cannot dim — it can only be bigger or smaller, and a sparkle that
        // swells and shrinks is what reads as twinkling.
        const lit = reduced ? 0.7 : starBrightness(star, elapsed);
        const r = star.size * (0.45 + lit * 0.85);
        if (r < 0.6) continue;
        // The outline is redrawn as it swells rather than zoomed: the hand
        // drifts alongside the twinkle, so what the eye reads is successive
        // drawings of the same star and not one shape being scaled. Held at
        // its opening pose when the field is still — the wobble is shape, not
        // motion, so a reduced-motion star is drawn but does not move.
        const hand = starHand(star, reduced ? 0 : elapsed);
        sparkle(ctx, star.x, star.y, sparkleShape(star.seed, r, hand), r, star.outlined);
      }

      if (!reduced) {
        nextAsteroid -= dt;
        if (nextAsteroid <= 0) {
          asteroids.push(spawnAsteroid(c.width, c.height, Math.random));
          nextAsteroid = ASTEROID_EVERY_MS * (0.5 + Math.random());
        }
        asteroids = asteroids
          .map((a) => stepAsteroid(a, dt))
          .filter((a) => !isSpent(a, c.width, c.height));

        for (const a of asteroids) {
          const mag = Math.hypot(a.vx, a.vy) || 1;
          const tailX = a.x - (a.vx / mag) * a.length;
          const tailY = a.y - (a.vy / mag) * a.length;
          const trail = ctx.createLinearGradient(a.x, a.y, tailX, tailY);
          trail.addColorStop(0, withAlpha(ink, 0.9));
          trail.addColorStop(1, withAlpha(ink, 0));
          ctx.strokeStyle = trail;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
        }
        raf = requestAnimationFrame(draw);
      }
    }

    size();
    raf = requestAnimationFrame(draw);

    const observer = new ResizeObserver(() => {
      size();
      // A still field has no loop to pick the new size up, so repaint it here.
      if (reduced) draw(performance.now());
    });
    observer.observe(canvas);

    // A backgrounded tab should not be animating a sky nobody is looking at.
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        last = 0;
        raf = requestAnimationFrame(draw);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      themeWatch.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="dither-field" aria-hidden />;
}
