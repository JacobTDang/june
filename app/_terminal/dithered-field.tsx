"use client";

import { useEffect, useRef } from "react";
import { autoLevels, bayerMatrix, ditherOrdered, luminance } from "@/src/visual/dither";

/** Bayer 4×4 dispersed — the chosen screen. Built once: it never changes. */
const SCREEN = bayerMatrix(4);

/** Resize is noisy; a drag would otherwise redither on every frame. */
const RESIZE_SETTLE_MS = 180;

/**
 * The black-and-white lattice behind the page.
 *
 * Runs the screen at the canvas's own pixel size rather than dithering small
 * and scaling up: an ordered screen upscaled turns into chunky blocks, and the
 * fineness of the lattice is most of the look.
 *
 * Cover-fits the source the way `background-size: cover` would, so the field
 * fills the viewport at any aspect without distorting.
 */
export function DitheredField({ src, gamma = 0.85 }: { src: string; gamma?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function paint() {
      const canvas = ref.current;
      const img = image.current;
      if (!canvas || !img || cancelled) return;

      // Cap the pixel count rather than the dimensions: a wide window and a
      // tall one should cost the same, and a 4K display should not pay 4× to
      // render a texture nobody inspects that closely.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const scale = Math.max(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);

      const frame = ctx.getImageData(0, 0, w, h);
      const gray = luminance(frame.data);
      autoLevels(gray, gamma);
      ditherOrdered(gray, w, h, SCREEN);
      for (let i = 0; i < gray.length; i++) {
        const v = gray[i]!;
        frame.data[i * 4] = v;
        frame.data[i * 4 + 1] = v;
        frame.data[i * 4 + 2] = v;
        frame.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(frame, 0, 0);
    }

    const img = new Image();
    // Same-origin assets today, but the canvas is read back, so a cross-origin
    // source without this would taint it and getImageData would throw.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      image.current = img;
      paint();
    };
    img.src = src;

    function onResize() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(paint, RESIZE_SETTLE_MS);
    }
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [src, gamma]);

  return <canvas ref={ref} className="dither-field" aria-hidden />;
}
