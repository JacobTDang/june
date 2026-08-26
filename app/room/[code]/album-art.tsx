"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { autoLevels, bayerMatrix, ditherOrdered, luminance } from "@/src/visual/dither";
import { highResArtwork } from "@/src/audio/artwork";

const SCREEN = bayerMatrix(4);

/**
 * The record on the turntable: the current track's cover, dithered.
 *
 * Dithered rather than shown flat so it belongs to the rest of the interface —
 * a full-colour photograph would be the only colour on an otherwise one-bit
 * page. Falls back to nothing rather than a placeholder graphic: an empty
 * stage before a track starts is honest, a fake cover is not.
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

  const paint = useCallback((image: HTMLImageElement) => {
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
    const scale = Math.max(w / image.width, h / image.height);
    const dw = image.width * scale;
    const dh = image.height * scale;
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
    let frame: ImageData;
    try {
      frame = ctx.getImageData(0, 0, w, h);
    } catch {
      console.warn(`[album art] cannot read pixels from ${src} (no CORS headers?)`);
      return;
    }
    const gray = luminance(frame.data);
    autoLevels(gray, 0.78);
    ditherOrdered(gray, w, h, SCREEN);
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i]!;
      frame.data[i * 4] = v;
      frame.data[i * 4 + 1] = v;
      frame.data[i * 4 + 2] = v;
      frame.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(frame, 0, 0);
    setReady(true);
  }, [src]);

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
