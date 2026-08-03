"use client";

import { useEffect, useRef } from "react";
import { isSilentFrame, spectrumColumns, type SpectrumConfig } from "@/src/audio/spectrum";

export type VisualizerMode = "reactive" | "pulse" | "idle";

/**
 * Reactive dot-matrix visualizer for the room player card. Renders a canvas
 * grid of the same amber dots as june's background field (see
 * WavesBackground in app/character-wave.tsx), lit column-by-column from an
 * AnalyserNode fed by a captureStream copy of the shared <audio> element's
 * output (never a reroute — see getAudioGraph below). Keeps the DOM layer thin:
 * all the actual spectrum math lives in src/audio/spectrum.ts and is
 * consumed verbatim here.
 */

/** Dot pitch this grid targets, in CSS px — matches the bg wave's spacing
 * (elementSize=22 in WavesBackground) so the grid reads as the same
 * design-system texture, not a bespoke widget. Columns/rows are then derived
 * from the card's actual size, so ~24x7 is the grid at the card's normal
 * size, not a hardcoded constant. */
const TARGET_CELL_PX = 22;
const MIN_COLUMNS = 12;
const MAX_COLUMNS = 40;
const MIN_ROWS = 4;
const MAX_ROWS = 10;

const FFT_SIZE = 128;
const SPECTRUM_SMOOTHING = 0.65;

// spectrumColumns throws if columns > bins.length (bins.length is
// FFT_SIZE / 2), but that check only fires per-frame inside the rAF loop —
// catch a bad constant at module load instead of a live playback session.
if (MAX_COLUMNS > FFT_SIZE / 2) {
  throw new Error(
    `MAX_COLUMNS (${MAX_COLUMNS}) must not exceed FFT_SIZE / 2 (${FFT_SIZE / 2})`,
  );
}

/** How long a "reactive" tap must read as continuous silence while the
 * element is actually playing before we give up on it — a tainted
 * (cross-origin) tap reads as permanent silence, not a quiet song. Audible
 * playback is unaffected either way: CORS tainting only blocks readable
 * analyser data, never the element's own audio output, so the loader keeps
 * playing normally while the visualizer quietly downgrades to the shimmer. */
const SILENCE_FALLBACK_MS = 3000;

/** rgb() triple for --accent (#f2b552, see app/globals.css) — reused as-is
 * rather than introducing a new hue for the visualizer. */
const ACCENT_RGB = "242, 181, 82";
const DOT_BASE_ALPHA = 0.14;
const DOT_PEAK_ALPHA = 0.95;
const DOT_RADIUS_RATIO = 0.16;

interface AudioGraph {
  context: AudioContext;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
}

interface Grid {
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** captureStream isn't in the standard lib DOM types for HTMLAudioElement
 * yet. Firefox only ever shipped it under the legacy-prefixed
 * mozCaptureStream name rather than the unprefixed method other non-Safari
 * engines use, so both must be feature-detected; this is the narrowest way
 * to do that without reaching for `any`. */
type CaptureCapableAudio = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

/**
 * Build a read-only *copy* of the element's audio for the analyser, never a
 * reroute. `captureStream` clones the element's output into a MediaStream;
 * feeding that (not the element itself) into the AudioContext means the
 * element keeps playing through its own native output path untouched. A
 * suspended AudioContext (iOS backgrounding, tab throttling, etc.) can then
 * only freeze the analyser's data — it can never silence audible playback,
 * which `createMediaElementSource` risked because it reroutes the element's
 * actual output through the (suspendable) context graph.
 *
 * Returns null when there is no usable tap: Safari implements neither
 * captureStream nor the Firefox-prefixed mozCaptureStream on <audio>
 * elements, so it's the one engine that gets the shimmer fallback — which
 * is the correct trade either way, since it costs only the visualizer,
 * never the audio, because playback must never depend on the visualizer
 * working.
 */
function getAudioGraph(audio: HTMLAudioElement): AudioGraph | null {
  const captureCapable = audio as CaptureCapableAudio;
  const captureStream = captureCapable.captureStream ?? captureCapable.mozCaptureStream;
  if (typeof captureStream !== "function") {
    return null;
  }
  try {
    const stream = captureStream.call(captureCapable);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    // Deliberately never connected to context.destination — see the
    // function doc: this graph is a tap, not a playback path.
    return {
      context,
      analyser,
      bins: new Uint8Array(analyser.frequencyBinCount),
    };
  } catch {
    // Deliberate best-effort path: AudioContext/tap construction can throw
    // outright in some environments (no Web Audio support, a restrictive
    // embed context). The caller falls back to the pulse shimmer for the
    // rest of the session — playback itself is unaffected, since nothing
    // here ever touches the element's normal output path.
    return null;
  }
}

function computeGrid(width: number, height: number): { cols: number; rows: number } {
  const cols = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(width / TARGET_CELL_PX)));
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(height / TARGET_CELL_PX)));
  return { cols, rows };
}

function idleIntensities(cols: number): number[] {
  return new Array(cols).fill(0);
}

/** Slow breathing wave used for "pulse" (loading/preparing) and as the
 * permanent shimmer once the reactive tap has been given up on. */
function pulseIntensities(cols: number, now: number): number[] {
  const phase = now / 1400;
  const result = new Array<number>(cols);
  for (let c = 0; c < cols; c++) {
    const wave = 0.5 + 0.5 * Math.sin(phase - c * 0.35);
    result[c] = 0.12 + 0.3 * wave;
  }
  return result;
}

/** Paint the dot-matrix: every dot sits at a faint baseline (the same static
 * field look as idle), and each column lights its dots bottom-up according
 * to `intensities[c]` (0..1), with brightness falling off toward the top of
 * the lit range. */
function drawDots(ctx: CanvasRenderingContext2D, grid: Grid, intensities: readonly number[]): void {
  const { cols, rows, width, height } = grid;
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0) return;
  const cellW = width / cols;
  const cellH = height / rows;
  const radius = Math.max(0.6, Math.min(cellW, cellH) * DOT_RADIUS_RATIO);

  // Fill color never changes between dots — only opacity does — so set it
  // once per frame and vary ctx.globalAlpha per dot instead of building a
  // fresh rgba() template string per dot (this grid can be hundreds of dots).
  ctx.fillStyle = `rgb(${ACCENT_RGB})`;
  for (let c = 0; c < cols; c++) {
    const litRows = (intensities[c] ?? 0) * rows;
    const cx = cellW * (c + 0.5);
    for (let r = 0; r < rows; r++) {
      const fromBottom = rows - 1 - r;
      let alpha = DOT_BASE_ALPHA;
      if (fromBottom < litRows) {
        const coverage = Math.min(1, litRows - fromBottom);
        const nearBase = 1 - (fromBottom / Math.max(1, rows - 1)) * 0.35;
        alpha = DOT_BASE_ALPHA + (DOT_PEAK_ALPHA - DOT_BASE_ALPHA) * coverage * nearBase;
      }
      const cy = cellH * (r + 0.5);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function PixelVisualizer({
  audio,
  mode,
}: {
  audio: HTMLAudioElement | null;
  mode: VisualizerMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const gridRef = useRef<Grid>({ cols: MIN_COLUMNS, rows: MIN_ROWS, width: 0, height: 0 });
  // Lazily built per mounted component (replaces a former module-level
  // WeakMap): nothing about the tap depends on playback anymore, so there's
  // no idempotency hazard to guard against — captureStream can be called
  // again freely — and holding it in a ref lets the draw effect's cleanup
  // close the context deterministically instead of leaking it.
  const graphRef = useRef<AudioGraph | null>(null);
  // Lets the [mode] effect below (and the reduce-motion listener) ask the
  // still-running draw effect to reschedule its rAF loop after an idle
  // draw-once has stopped it, without the draw effect itself depending on
  // `mode` (which would force it to tear down and rebuild the audio graph
  // on every mode change).
  const kickLoopRef = useRef<() => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Track the card's rendered size (devicePixelRatio-aware) so the grid, and
  // the canvas's backing store, always match the box it's painted into.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const { cols, rows } = computeGrid(width, height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      gridRef.current = { cols, rows, width, height };
      // Idle draws once and stops (see the draw effect below), so without
      // this kick a mount or resize that lands on/after that draw-once
      // would leave the grid blank until `mode` next changes. kickLoopRef
      // defaults to a no-op until the draw effect below assigns
      // scheduleLoop to it, so this is safe to call before that effect has
      // run; scheduleLoop's own running/visible guards make a redundant
      // kick harmless either way.
      kickLoopRef.current?.();
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      resize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // The rAF draw loop and the (lazily built) audio graph. Runs once the
  // audio element identity settles and lives for the component's lifetime —
  // `mode` and the grid size are read live via refs each frame, so this
  // effect never has to tear down and rebuild the audio graph on a mode
  // change. Idle frames are static, so the loop draws once and stops
  // scheduling itself; the [mode] effect below and the reduce-motion
  // listener restart it via kickLoopRef when that might no longer hold.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !ctx2d) return;
    // Narrowed once, outside the closure: TS can't carry the `!ctx2d` guard's
    // narrowing into `loop` below since it's a hoisted function declaration.
    const ctx: CanvasRenderingContext2D = ctx2d;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = reduceMotionQuery.matches;

    let visible = document.visibilityState === "visible";
    let raf = 0;
    // Explicit guard (in addition to `raf`) so scheduleLoop is safe to call
    // from every trigger — the loop's own tail call, onVisibility, the
    // reduce-motion listener, and the [mode] effect — without ever
    // double-scheduling a frame.
    let running = false;

    let prevColumns: number[] | null = null;
    let silenceStartedAt: number | null = null;
    // Set once, never cleared *within this effect run* — it only resets
    // when the audio element identity changes and this effect tears down
    // and reruns. A tainted tap or missing captureStream support doesn't
    // recover mid-session, so there's no point retrying it.
    let permanentFallback = false;

    // The captureStream MediaStream's audio track ends whenever the
    // element loads a new resource (e.g. skipping to the next track) —
    // it's tied to that one resource, not the element's lifetime. Left
    // alone, the analyser silently reads zeros forever, which the silence
    // window above then (mis)reads as 3s of real silence and permanently
    // downgrades to the shimmer, even though the new track is playing
    // fine. "emptied" fires on every such resource swap, so tear the graph
    // down here and let the next reactive frame lazily rebuild it
    // (`graphRef.current ??= getAudioGraph(audio)` below) against the new
    // stream.
    const onEmptied = () => {
      graphRef.current?.context.close().catch(() => {});
      graphRef.current = null;
      permanentFallback = false;
      silenceStartedAt = null;
    };
    audio?.addEventListener("emptied", onEmptied);

    const scheduleLoop = () => {
      if (running || !visible) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };

    const onReduceMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
      // Toggling off reduced motion may need to resume a loop that an idle
      // draw-once stopped; toggling on is a harmless no-op if already
      // running (the running guard makes this safe either way).
      scheduleLoop();
    };
    reduceMotionQuery.addEventListener("change", onReduceMotionChange);

    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) {
        // Stale timestamps accrued before the tab was hidden must not
        // instantly trip the fallback the moment we're visible again.
        silenceStartedAt = null;
        scheduleLoop();
      } else {
        // A frame already queued via requestAnimationFrame can be dropped
        // outright by bfcache/page-freeze instead of firing — which would
        // otherwise leave `running` stuck true forever and wedge
        // scheduleLoop from ever rescheduling once visible again.
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        running = false;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    function loop(now: number) {
      running = false;
      raf = 0;
      if (!visible) return;
      const grid = gridRef.current;

      // prefers-reduced-motion always wins: the idle grid, no exceptions.
      let effective: VisualizerMode;
      if (reduceMotion) {
        effective = "idle";
      } else {
        const requested = modeRef.current;
        effective = permanentFallback && requested === "reactive" ? "pulse" : requested;
      }

      if (effective === "reactive" && audio) {
        graphRef.current ??= getAudioGraph(audio);
        const graph = graphRef.current;
        if (!graph) {
          permanentFallback = true;
          drawDots(ctx, grid, pulseIntensities(grid.cols, now));
        } else {
          if (graph.context.state === "suspended") {
            // A rejected resume only costs visualizer data — silence
            // detection below then shows the shimmer fallback — because
            // playback no longer depends on this context at all (the tap
            // is a captureStream copy, not a reroute). Hoisted so this
            // runs every reactive frame before the silence bookkeeping.
            void graph.context.resume().catch(() => {});
          }
          graph.analyser.getByteFrequencyData(graph.bins);

          // Only count a frame toward the silence window when it's a
          // trustworthy read: actually playing, with enough buffered data
          // to expect real analyser output, and the tap context actually
          // running (not still suspended from the resume above). Anything
          // else (paused, buffering, suspended) just leaves the window
          // where it was — it neither advances nor resets it. (`visible` is
          // not part of this check: the loop already returned above when
          // hidden, so this line never runs while hidden.)
          const trustworthy =
            !audio.paused &&
            audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
            graph.context.state === "running";

          if (trustworthy) {
            if (isSilentFrame(graph.bins)) {
              silenceStartedAt ??= now;
              if (now - silenceStartedAt >= SILENCE_FALLBACK_MS) permanentFallback = true;
            } else {
              silenceStartedAt = null;
            }
          }

          if (permanentFallback) {
            drawDots(ctx, grid, pulseIntensities(grid.cols, now));
          } else {
            const config: SpectrumConfig = { columns: grid.cols, smoothing: SPECTRUM_SMOOTHING };
            prevColumns = spectrumColumns(graph.bins, prevColumns, config);
            drawDots(ctx, grid, prevColumns);
          }
        }
      } else {
        prevColumns = null;
        silenceStartedAt = null;
        const intensities =
          effective === "pulse" ? pulseIntensities(grid.cols, now) : idleIntensities(grid.cols);
        drawDots(ctx, grid, intensities);
      }

      if (effective === "idle") {
        // Idle is a static frame — nothing to gain by repainting it at
        // 60fps. Stop here; kickLoopRef (the [mode] effect, and the
        // reduce-motion listener above) restarts the loop if that stops
        // being true.
        return;
      }

      scheduleLoop();
    }

    kickLoopRef.current = scheduleLoop;
    scheduleLoop();

    return () => {
      kickLoopRef.current = () => {};
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotionQuery.removeEventListener("change", onReduceMotionChange);
      audio?.removeEventListener("emptied", onEmptied);
      // Nothing depends on this context for playback anymore, so close it
      // properly instead of leaking it. A rejected close here is just a
      // teardown race (e.g. already closed) and is benign.
      graphRef.current?.context.close().catch(() => {});
      graphRef.current = null;
    };
  }, [audio]);

  // Idle frames stop the rAF loop (see above); when `mode` changes we may
  // need to wake it back up. scheduleLoop's own `running` guard makes this a
  // no-op when the loop is already going.
  useEffect(() => {
    kickLoopRef.current();
  }, [mode]);

  return (
    <div ref={containerRef} className="audio-stage__canvas" aria-hidden="true">
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
