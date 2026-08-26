"use client";

import { useEffect, useRef } from "react";
import {
  isSpent,
  makeStars,
  spawnAsteroid,
  starBrightness,
  stepAsteroid,
  type Asteroid,
  type Star,
} from "@/src/visual/starfield";

/** Stars per million pixels — density, so a laptop and a big display look the
 *  same rather than one looking empty. */
const DENSITY = 190;
const MAX_STARS = 700;
/** Mean gap between asteroids. Rare enough to feel like an event. */
const ASTEROID_EVERY_MS = 5200;

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
/**
 * The four-pointed sparkle: points north, east, south and west, with the sides
 * pulled in toward the centre so the arms taper.
 *
 * The concave curve is the whole character of the shape — a straight-sided
 * version is a diamond, which reads as a gem rather than a glint. Each side is
 * a quadratic with its control point at the centre, which is what pinches the
 * waist.
 */
function sparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  outlined: boolean,
) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  if (outlined && r > 3) {
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.fill();
  }
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars: Star[] = [];
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
    }

    function draw(now: number) {
      const c = ref.current;
      if (!c || !ctx) return;
      const dt = last === 0 ? 16 : Math.min(now - last, 64);
      last = now;
      if (started === 0) started = now;
      const elapsed = now - started;

      // Paper, not night sky: the page is light, so the stars are ink on it.
      ctx.fillStyle = "#f4f3ee";
      ctx.fillRect(0, 0, c.width, c.height);

      ctx.fillStyle = "#111111";
      ctx.strokeStyle = "#111111";
      for (const star of stars) {
        // Brightness drives *size*, not opacity. On a one-bit page a star
        // cannot dim — it can only be bigger or smaller, and a sparkle that
        // swells and shrinks is what reads as twinkling.
        const lit = reduced ? 0.7 : starBrightness(star, elapsed);
        const r = star.size * (0.45 + lit * 0.85);
        if (r < 0.6) continue;
        sparkle(ctx, star.x, star.y, r, star.outlined);
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
          trail.addColorStop(0, "rgba(17,17,17,0.9)");
          trail.addColorStop(1, "rgba(17,17,17,0)");
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
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="dither-field" aria-hidden />;
}
