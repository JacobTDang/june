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
  const paletteRef = useRef<Swatch[]>([]);
  /** Two renderings of the same lattice, built once per cover and composited
   *  into the visible canvas each frame: one plain, one where every lit pixel
   *  carries its own colour from the sleeve. */
  const monoRef = useRef<HTMLCanvasElement | null>(null);
  /** Scratch surface for cutting the coloured lattice to a disc. Reused rather
   *  than allocated per frame. */
  const cutRef = useRef<HTMLCanvasElement | null>(null);
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
    //
    // Anchored to the bottom, not the centre: sleeves put their type along the
    // bottom edge far more often than the top, so cropping from the top keeps
    // the artist and title in frame where centring would slice both.
    // Horizontally it stays centred — covers are usually composed around their
    // middle.
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
    const mono = monoRef.current ?? document.createElement("canvas");
    monoRef.current = mono;
    mono.width = w;
    mono.height = h;
    mono.getContext("2d")?.putImageData(frame, 0, 0);

    // Plain until the music says otherwise; the frame loop takes over from
    // here when this device is actually playing.
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

  // Colour rising through the sleeve with the music, composited straight into
  // the artwork rather than layered over it — one canvas, so there are no two
  // surfaces to fall out of alignment.
  useEffect(() => {
    const canvas = ref.current;
    const audio = audioRef?.current;
    if (!canvas || !audio || !active || !ready) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let level = 0;
    let lobe = 0;
    let edge = 0;
    let spin = 0;
    let graph = getAudioGraph(audio);

    // The tap can fail simply because it was asked too early: this effect runs
    // when the *artwork* is ready, which can be before the element has a live
    // audio track, and capturing a track-less stream throws. So try again when
    // playback actually starts. A tap that never succeeds (Safari implements
    // neither captureStream nor the Firefox-prefixed form on <audio>) leaves
    // the sleeve one-bit, which costs the colour and never the music.
    function attach() {
      if (graph) return;
      graph = getAudioGraph(audio!);
      if (graph && raf === 0) raf = requestAnimationFrame(frame);
    }
    // Both events: `playing` catches a track that starts later, and
    // `timeupdate` catches one that was already going before this effect ran —
    // which is the common case, since the artwork finishes dithering after
    // playback has begun. timeupdate fires a few times a second and attach()
    // is a no-op once the tap exists.
    audio.addEventListener("playing", attach);
    audio.addEventListener("timeupdate", attach);

    function frame() {
      const c = ref.current;
      const mono = monoRef.current;
      const colored = coloredRef.current;
      if (!c || !ctx || !graph || !mono || !colored) {
        raf = 0;
        return;
      }
      const w = c.width;
      const h = c.height;

      graph.analyser.getByteFrequencyData(graph.bins);
      const bins = graph.bins;
      // Three bands, not one average. A single number is why the colour only
      // breathed: everything moved together, so the shape never changed. Split
      // apart they disagree — bass swells the field, mids swing the lobes,
      // treble bites the edge — and the disagreement is the motion.
      const lowEnd = Math.floor(bins.length * 0.12);
      const midEnd = Math.floor(bins.length * 0.42);
      let low = 0;
      let middle = 0;
      let high = 0;
      for (let i = 0; i < lowEnd; i++) low += bins[i]!;
      for (let i = lowEnd; i < midEnd; i++) middle += bins[i]!;
      for (let i = midEnd; i < bins.length; i++) high += bins[i]!;
      const lowT = low / (lowEnd * 255);
      const midT = middle / ((midEnd - lowEnd) * 255);
      const highT = high / ((bins.length - midEnd) * 255);

      // Fast to rise, slow to fall, so a kick reads as a hit and not a wobble.
      level += (lowT - level) * (lowT > level ? 0.5 : 0.05);
      lobe += (midT - lobe) * 0.2;
      edge += (highT - edge) * 0.38;
      spin += 0.008 + lowT * 0.05;

      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(mono, 0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      // Reach is half the diagonal, so a radius of one covers the corners.
      // It sits near full at rest and swells past it: the sleeve should read
      // as being in colour, with the music moving the edge, rather than as a
      // small disc floating in a monochrome frame.
      const reach = Math.hypot(w, h) * 0.5;

      const cut = cutRef.current ?? document.createElement("canvas");
      cutRef.current = cut;
      if (cut.width !== w || cut.height !== h) {
        cut.width = w;
        cut.height = h;
      }
      const cutCtx = cut.getContext("2d");
      if (cutCtx) {
        cutCtx.clearRect(0, 0, w, h);
        cutCtx.globalCompositeOperation = "source-over";
        cutCtx.drawImage(colored, 0, 0, w, h);

        // A wide base the bass swells...
        cutCtx.globalCompositeOperation = "destination-in";
        const base = cutCtx.createRadialGradient(
          cx, cy, 0, cx, cy, Math.max(1, reach * (0.72 + level * 0.55)),
        );
        base.addColorStop(0, "rgba(0,0,0,1)");
        base.addColorStop(0.72, "rgba(0,0,0,1)");
        base.addColorStop(1, "rgba(0,0,0,0)");
        cutCtx.fillStyle = base;
        cutCtx.fillRect(0, 0, w, h);

        // ...then bitten into from outside, so the rim is ragged and moving
        // rather than a clean circle. The bites counter-rotate at a rate the
        // bass sets, and the treble decides how deep they cut.
        cutCtx.globalCompositeOperation = "destination-out";
        for (let i = 0; i < 3; i++) {
          const angle = spin * (i % 2 === 0 ? 1 : -1.45) + (i * Math.PI * 2) / 3;
          const dist = reach * (0.66 + lobe * 0.55);
          const bx = cx + Math.cos(angle) * dist;
          const by = cy + Math.sin(angle) * dist;
          const br = Math.max(1, reach * (0.3 + edge * 0.5));
          const bite = cutCtx.createRadialGradient(bx, by, 0, bx, by, br);
          bite.addColorStop(0, "rgba(0,0,0,0.95)");
          bite.addColorStop(1, "rgba(0,0,0,0)");
          cutCtx.fillStyle = bite;
          cutCtx.fillRect(0, 0, w, h);
        }
        cutCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(cut, 0, 0);
      }
      raf = requestAnimationFrame(frame);
    }
    if (graph) raf = requestAnimationFrame(frame);

    return () => {
      audio.removeEventListener("playing", attach);
      audio.removeEventListener("timeupdate", attach);
      cancelAnimationFrame(raf);
      // Leave the sleeve as it was found: plain, and matching what a device
      // that never played would show.
      const c = ref.current;
      const mono = monoRef.current;
      if (c && mono) c.getContext("2d")?.drawImage(mono, 0, 0, c.width, c.height);
      // The context is shared with anything else tapping this element and
      // outlives this effect; closing it here would silence the next run.
    };
  }, [audioRef, active, ready, src]);

  return (
    <canvas
      ref={ref}
      className={`albumart${ready ? " albumart--ready" : ""}`}
      role="img"
      aria-label={title ? `Cover art for ${title}` : "No track playing"}
    />
  );
}
