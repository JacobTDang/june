"use client";

import { useEffect, useRef } from "react";
import { isSilentFrame, spectrumColumns, type SpectrumConfig } from "@/src/audio/spectrum";

export type VisualizerMode = "reactive" | "pulse" | "idle";

/**
 * Reactive dot-matrix visualizer for the room player card. Renders a canvas
 * grid of the same amber dots as june's background field (see
 * WavesBackground in app/character-wave.tsx), lit column-by-column from an
 * AnalyserNode tap on the shared <audio> element. Keeps the DOM layer thin:
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

// createMediaElementSource throws if it is ever called a second time for the
// same <audio> element (even from a different AudioContext). This map makes
// graph creation idempotent per element for the page's lifetime, regardless
// of how many times a PixelVisualizer mounts/remounts.
const audioGraphs = new WeakMap<HTMLAudioElement, AudioGraph>();

function getAudioGraph(audio: HTMLAudioElement): AudioGraph | null {
  const existing = audioGraphs.get(audio);
  if (existing) return existing;
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(context.destination);
    const graph: AudioGraph = {
      context,
      analyser,
      bins: new Uint8Array(analyser.frequencyBinCount),
    };
    audioGraphs.set(audio, graph);
    return graph;
  } catch {
    // Deliberate best-effort path: AudioContext/tap construction can throw
    // outright in some environments (no Web Audio support, a restrictive
    // embed context). The caller falls back to the pulse shimmer for the
    // rest of the session — playback itself is unaffected, since nothing
    // here touches the element's normal output path unless this succeeds.
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
      ctx.beginPath();
      ctx.fillStyle = `rgba(${ACCENT_RGB}, ${alpha.toFixed(3)})`;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
  // change (which would also risk re-throwing on createMediaElementSource).
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx2d = canvas?.getContext("2d");
    if (!canvas || !ctx2d) return;
    // Narrowed once, outside the closure: TS can't carry the `!ctx2d` guard's
    // narrowing into `loop` below since it's a hoisted function declaration.
    const ctx: CanvasRenderingContext2D = ctx2d;

    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = reduceMotionQuery.matches;
    const onReduceMotionChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches;
    };
    reduceMotionQuery.addEventListener("change", onReduceMotionChange);

    let visible = document.visibilityState === "visible";
    let raf = 0;
    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible && raf === 0) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);

    let prevColumns: number[] | null = null;
    let silenceStartedAt: number | null = null;
    // Set once, never cleared: a tainted tap or missing AudioContext support
    // doesn't recover mid-session, so there's no point retrying it.
    let permanentFallback = false;

    function loop(now: number) {
      raf = 0;
      if (!visible) return;
      const grid = gridRef.current;

      if (reduceMotion) {
        // prefers-reduced-motion always wins: the idle grid, no exceptions.
        drawDots(ctx, grid, idleIntensities(grid.cols));
      } else {
        const requested = modeRef.current;
        const effective = permanentFallback && requested === "reactive" ? "pulse" : requested;

        if (effective === "reactive" && audio) {
          const graph = getAudioGraph(audio);
          if (!graph) {
            permanentFallback = true;
            drawDots(ctx, grid, pulseIntensities(grid.cols, now));
          } else {
            if (graph.context.state === "suspended") void graph.context.resume();
            graph.analyser.getByteFrequencyData(graph.bins);

            if (!audio.paused && isSilentFrame(graph.bins)) {
              silenceStartedAt ??= now;
              if (now - silenceStartedAt >= SILENCE_FALLBACK_MS) permanentFallback = true;
            } else {
              silenceStartedAt = null;
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
      }

      raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMotionQuery.removeEventListener("change", onReduceMotionChange);
    };
  }, [audio]);

  return (
    <div ref={containerRef} className="audio-stage__canvas" aria-hidden="true">
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
