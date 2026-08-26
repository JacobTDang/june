"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { contentBounds } from "@/src/visual/content-bounds";
import { autoLevels, bayerMatrix, ditherOrdered, luminance } from "@/src/visual/dither";
import { highResArtwork } from "@/src/audio/artwork";

const SCREEN = bayerMatrix(4);
/** Push each pixel away from its own grey. A dithered sleeve's lit pixels are
 *  its brighter ones, which are often its least saturated; without this the
 *  colour reads as a dirty white. */
const BOOST = 2.1;

/**
 * The now-playing sleeve, screened to a dot lattice and carrying the record's
 * own colours.
 *
 * Every lit dot keeps the colour that pixel actually had. Nothing here picks a
 * palette — the sleeve is simply screened rather than converted, so what you
 * see is the record's, at the resolution of the dither.
 *
 * Falls back to nothing rather than a placeholder graphic: an empty frame
 * reads as a moment before the artwork arrives, a grey rectangle reads as
 * something that failed to load.
 */
export function AlbumArt({
  artworkUrl,
  title,
}: {
  artworkUrl: string | null;
  title: string | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const src = highResArtwork(artworkUrl);

  const paint = useCallback(
    (image: HTMLImageElement) => {
      const canvas = ref.current;
      if (!canvas) return;
      // Fills its frame, 1:1 with CSS pixels — a dither must never be scaled,
      // and the frame is rarely square while a sleeve always is.
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Cover-fit: crop to fill rather than letterbox. A sleeve floating in a
      // band of empty card reads as a mistake; a cropped one reads as a frame.
      //
      // Anchored to the bottom, not the centre: sleeves put their type along
      // the bottom edge far more often than the top, so cropping from the top
      // keeps the artist and title in frame where centring would slice both.
      const scale = Math.max(w / image.width, h / image.height);
      const dw = image.width * scale;
      const dh = image.height * scale;
      ctx.drawImage(image, (w - dw) / 2, h - dh, dw, dh);

      let frame: ImageData;
      try {
        frame = ctx.getImageData(0, 0, w, h);
      } catch {
        console.warn(`[album art] cannot read pixels from ${src} (no CORS headers?)`);
        return;
      }

      // Cover art comes from 16:9 YouTube thumbnails far more often than not,
      // so a square sleeve arrives sitting in bars — flat, or a blurred
      // blow-up of itself. They are the thumbnail's shape, not the record's,
      // so they are cropped away and the picture fills its frame the way it
      // does on a shelf.
      const box = contentBounds(frame.data, w, h);
      if (box.right - box.left < w || box.bottom - box.top < h) {
        // Back into the source image's own pixels, undoing the cover-fit.
        const sx = (box.left - (w - dw) / 2) / scale;
        const sy = (box.top - (h - dh)) / scale;
        const sw = (box.right - box.left) / scale;
        const sh = (box.bottom - box.top) / scale;
        const crop = Math.max(w / sw, h / sh);
        const cw = sw * crop;
        const ch = sh * crop;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(image, sx, sy, sw, sh, (w - cw) / 2, h - ch, cw, ch);
        try {
          frame = ctx.getImageData(0, 0, w, h);
        } catch {
          console.warn(`[album art] cannot read pixels from ${src} (no CORS headers?)`);
          return;
        }
      }

      // The colours before the screen decides which dots survive.
      const source = new Uint8ClampedArray(frame.data);

      const gray = luminance(frame.data);
      autoLevels(gray, 0.78);
      ditherOrdered(gray, w, h, SCREEN);

      // The same lattice the monochrome pass would give, except every lit dot
      // carries the colour that pixel actually had.
      //
      // Unlit dots are painted opaque ink, never left transparent. A
      // photograph is not part of the interface and must not invert with it:
      // letting the page show through the gaps made the sleeve read correctly
      // on the dark theme and fall apart on the light one, where paper came up
      // through the dots that carry the picture's shadows.
      for (let i = 0; i < gray.length; i++) {
        if (gray[i] === 0) {
          frame.data[i * 4] = 0;
          frame.data[i * 4 + 1] = 0;
          frame.data[i * 4 + 2] = 0;
          frame.data[i * 4 + 3] = 255;
          continue;
        }
        const r = source[i * 4]!;
        const g = source[i * 4 + 1]!;
        const b = source[i * 4 + 2]!;
        const mid = (r + g + b) / 3;
        frame.data[i * 4] = Math.max(0, Math.min(255, mid + (r - mid) * BOOST));
        frame.data[i * 4 + 1] = Math.max(0, Math.min(255, mid + (g - mid) * BOOST));
        frame.data[i * 4 + 2] = Math.max(0, Math.min(255, mid + (b - mid) * BOOST));
        frame.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(frame, 0, 0);
      setReady(true);
    },
    [src],
  );

  useEffect(() => {
    setReady(false);
    if (!src) return;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!cancelled) paint(image);
    };
    image.onerror = () => console.warn(`[album art] could not load ${src}`);
    image.src = src;

    const observer = new ResizeObserver(() => {
      const canvas = ref.current;
      if (!canvas || cancelled || !image.complete) return;
      // Guard against our own paint: setting canvas.width/height changes the
      // element's intrinsic size, which fires this observer again. Without
      // the comparison it repaints forever and the art appears to zoom.
      if (
        canvas.width === Math.round(canvas.clientWidth) &&
        canvas.height === Math.round(canvas.clientHeight)
      ) {
        return;
      }
      paint(image);
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [src, paint]);

  return (
    <canvas
      ref={ref}
      className={`albumart${ready ? " albumart--ready" : ""}`}
      role="img"
      aria-label={title ? `Cover art for ${title}` : "No track playing"}
    />
  );
}
