"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { autoLevels, bayerMatrix, ditherOrdered, luminance } from "@/src/visual/dither";
import { dominantColors, type Swatch } from "@/src/visual/palette";
import { highResArtwork } from "@/src/audio/artwork";
import { getAudioGraph } from "./audio-graph";

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
  audioRef,
  active,
}: {
  artworkUrl: string | null;
  title: string | null;
  /** The element the room plays through. Passed as the ref rather than its
   *  current value: a ref does not re-render when it fills, so reading
   *  `.current` during render hands this component null on the first pass and
   *  never corrects it. */
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  /** Whether this device is actually making sound. A muted device has nothing
   *  to visualise and should not open an AudioContext at all. */
  active?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Swatch[]>([]);
  /** The same dither, but every lit pixel carrying its own colour from the
   *  sleeve. Built once per cover; the bloom masks it per frame. */
  const coloredRef = useRef<HTMLCanvasElement | null>(null);
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
    // Read the palette before dithering: after it there are two colours left.
    paletteRef.current = dominantColors(frame.data, 3);

    // Keep the original pixels: the coloured pass needs each pixel's own
    // colour, not an average of the whole sleeve.
    const source = new Uint8ClampedArray(frame.data);

    const gray = luminance(frame.data);
    autoLevels(gray, 0.78);
    ditherOrdered(gray, w, h, SCREEN);

    // A second copy of the same lattice, where every lit pixel carries the
    // colour that pixel actually had. Masked by the bloom rather than washed
    // over, so the colour is the record's own, pixel for pixel.
    const colored = coloredRef.current ?? document.createElement("canvas");
    coloredRef.current = colored;
    colored.width = w;
    colored.height = h;
    const cctx = colored.getContext("2d");
    if (cctx) {
      const tinted = cctx.createImageData(w, h);
      for (let i = 0; i < gray.length; i++) {
        if (gray[i] === 0) {
          // Unlit stays transparent so the monochrome dither shows through.
          tinted.data[i * 4 + 3] = 0;
          continue;
        }
        const r = source[i * 4]!;
        const g = source[i * 4 + 1]!;
        const b = source[i * 4 + 2]!;
        // Push each pixel away from its own grey. A dithered sleeve's lit
        // pixels are its brighter ones, which are often the least saturated;
        // without this the colour reads as a dirty white.
        const mid = (r + g + b) / 3;
        const boost = 2.1;
        tinted.data[i * 4] = Math.max(0, Math.min(255, mid + (r - mid) * boost));
        tinted.data[i * 4 + 1] = Math.max(0, Math.min(255, mid + (g - mid) * boost));
        tinted.data[i * 4 + 2] = Math.max(0, Math.min(255, mid + (b - mid) * boost));
        tinted.data[i * 4 + 3] = 255;
      }
      cctx.putImageData(tinted, 0, 0);
    }

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

  // The bloom: the album's own colours, rising from the centre with the music.
  useEffect(() => {
    const canvas = bloomRef.current;
    const audio = audioRef?.current;
    // `ready` too: the bloom is part of the artwork, not a layer over the
    // stage. Without it a track change left colour glowing over an empty
    // frame until the next cover finished dithering.
    if (!canvas || !audio || !active || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const graph = getAudioGraph(audio);
    // No tap available (Safari implements neither captureStream nor the
    // Firefox-prefixed form on <audio>). The sleeve simply stays one-bit,
    // which costs the colour and never the music.
    if (!graph) return;

    let raf = 0;
    let level = 0;

    function frame() {
      const c = bloomRef.current;
      if (!c || !ctx || !graph) return;
      const w = Math.max(1, Math.round(c.clientWidth));
      const h = Math.max(1, Math.round(c.clientHeight));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }

      graph.analyser.getByteFrequencyData(graph.bins);
      // Low bins only: the bloom answers to the body of the track rather than
      // to cymbals, which would make it flicker.
      let sum = 0;
      const bass = Math.floor(graph.bins.length * 0.18);
      for (let i = 0; i < bass; i++) sum += graph.bins[i]!;
      const target = sum / (bass * 255);
      // Eased, because a bloom that tracks every frame exactly reads as
      // strobing rather than as breathing.
      level += (target - level) * 0.12;

      ctx.clearRect(0, 0, w, h);
      const colored = coloredRef.current;
      if (colored && colored.width > 0) {
        // The coloured lattice, then a radial mask over it: colour reaches out
        // from the centre as the track swells and pulls back when it eases.
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(colored, 0, 0, w, h);

        const cx = w / 2;
        const cy = h / 2;
        const reach = Math.hypot(w, h) * 0.5;
        const inner = reach * (0.15 + level * 0.55);
        const mask = ctx.createRadialGradient(cx, cy, inner * 0.2, cx, cy, Math.max(inner, 1));
        mask.addColorStop(0, "rgba(0,0,0,1)");
        mask.addColorStop(0.75, "rgba(0,0,0,0.85)");
        mask.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = mask;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      const c = bloomRef.current;
      // Clear on the way out: the canvas keeps its last frame otherwise, and
      // that frame would sit under the next cover as it fades in.
      if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
      void graph.context.close();
    };
  }, [audioRef, active, ready, src]);

  return (
    <>
      <canvas
        ref={ref}
        className={`albumart${ready ? " albumart--ready" : ""}`}
        role="img"
        aria-label={title ? `Cover art for ${title}` : "No track playing"}
      />
      {/* Over the dither, multiplied into it: the colour tints the black of
          the lattice rather than sitting on top as a film. */}
      <canvas
        ref={bloomRef}
        className={`albumart__bloom${ready ? " albumart__bloom--ready" : ""}`}
        aria-hidden
      />
    </>
  );
}
