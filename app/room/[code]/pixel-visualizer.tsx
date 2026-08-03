"use client";

import { useEffect, useRef, useState } from "react";
import { isSilentFrame, spectrumColumns, type SpectrumConfig } from "@/src/audio/spectrum";
import { MAX_COLUMNS, computeGrid } from "@/src/audio/grid";
import { highResArtwork } from "@/src/audio/artwork";

export type VisualizerMode = "reactive" | "pulse" | "idle";

/**
 * Reactive dot-matrix visualizer for the room player card. Renders a canvas
 * grid of the same amber dots as june's background field (see
 * WavesBackground in app/character-wave.tsx) as a radial bloom — bass lights
 * the centre, treble ripples outward to the rim — from an AnalyserNode fed
 * by a captureStream copy of the shared <audio> element's output (never a
 * reroute — see getAudioGraph below). Keeps the DOM layer thin: all the
 * actual spectrum math lives in src/audio/spectrum.ts and is consumed
 * verbatim here; this file only maps that data onto the dot field.
 */

/** Raised from 128 (64 bins) so the wider MAX_COLUMNS (see src/audio/grid.ts)
 * has headroom — see the module-load assertion just below. */
const FFT_SIZE = 256;
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
const DOT_BASE_ALPHA = 0.12;
const DOT_PEAK_ALPHA = 0.95;
/** Music keeps most bands loud most of the time, so raw band levels light
 * every dot at once and the field reads as a solid wall. Gamma pushes the
 * mid-range down so only genuinely strong bands bloom, which is what gives
 * the grid its dynamics. */
const BLOOM_GAMMA = 1.7;
/** How much of a dot's bloom is lost by the rim. Without this the radial
 * mapping is invisible on loud passages — every ring lights equally — so the
 * centre keeps its full range and the outer rings are attenuated. */
const RADIAL_FALLOFF = 0.35;
/** Distance→band curve. >1 pushes the loud low bands outward so they bloom
 * across several rings instead of only the centre dot. */
const BAND_CURVE = 1.6;
/** Unlit baseline radius (as a fraction of the cell pitch) — the same static
 * dot size idle/quiet dots have always had. Nudged down slightly from 0.13:
 * the ratio alone scales with the cell pitch, but a whole ring's worth of
 * these tightly-packed cells blooming together at once now reads as one
 * fused band rather than distinct sparks unless the gap between neighbours
 * grows a bit to compensate for the higher dot count per ring. */
const DOT_RADIUS_RATIO = 0.11;
/** Fully-bloomed radius at intensity 1. Chosen so a dot at peak size (with
 * the cell pitch this grid targets) still leaves a visible gap to its
 * neighbours rather than merging into a blob — see drawRadial. Nudged down
 * from 0.32 for the same reason as DOT_RADIUS_RATIO above. */
const DOT_RADIUS_RATIO_PEAK = 0.27;

/** Per-band attack/decay factors for the reactive envelope: rise fast toward
 * a new peak, fall slowly back down, so the bloom breathes instead of
 * flickering frame-to-frame with the raw spectrum data. Frame-rate-tolerant
 * in the sense that both are simple exponential-approach factors applied
 * once per drawn frame — same shape of tolerance the existing smoothing in
 * spectrumColumns already relies on. */
const ENVELOPE_ATTACK = 0.35;
const ENVELOPE_DECAY = 0.06;

/** How many recent envelope frames each band keeps around, so outer rings
 * can sample a slightly stale value and read as a ripple washing outward
 * from a bass hit at the centre rather than every ring lighting in lockstep.
 * MAX_RIPPLE_DELAY_FRAMES must leave room for at least a 0-frame (current)
 * sample, hence the -1. */
const RIPPLE_HISTORY_LEN = 6;
const MAX_RIPPLE_DELAY_FRAMES = RIPPLE_HISTORY_LEN - 1;

/** One lap of the "pulse" ring per this many ms — matches the .live__dot /
 * .resume__dot livePulse keyframe (app/globals.css) so the visualizer's
 * loading shimmer breathes at the same cadence as the rest of the UI's
 * "something is live/pending" language, instead of inventing a new tempo. */
const PULSE_PERIOD_MS = 2600;

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
  /** Per-dot normalized distance from the card's centre, 0 at centre to 1 at
   * the farthest dot — indexed `r * cols + c`, same as the draw loop.
   * Precomputed once per resize (not per frame): it only depends on the
   * card's box, never on audio data, so recomputing it 60x/sec would be pure
   * waste on the hot path. */
  distances: Float32Array;
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

/** Distance field for the radial mapping: each dot's normalized distance
 * from the card's centre (0 at centre, 1 at the farthest dot). Pure
 * geometry — no audio data — so it's computed once whenever the card
 * resizes and then read every frame, instead of recomputing cols*rows
 * square roots on the hot path. */
function computeDistanceField(
  cols: number,
  rows: number,
  width: number,
  height: number,
): Float32Array {
  const distances = new Float32Array(cols * rows);
  const cellW = width / cols;
  const cellH = height / rows;
  const centreX = width / 2;
  const centreY = height / 2;
  // The farthest dot is always in (or next to) a corner; normalizing
  // against the geometric corner distance — rather than searching every dot
  // for the true max — is simpler and differs by at most half a cell.
  const maxDist = Math.hypot(centreX, centreY) || 1;
  for (let r = 0; r < rows; r++) {
    const cy = cellH * (r + 0.5);
    for (let c = 0; c < cols; c++) {
      const cx = cellW * (c + 0.5);
      distances[r * cols + c] = Math.min(1, Math.hypot(cx - centreX, cy - centreY) / maxDist);
    }
  }
  return distances;
}

/** Per-band envelope + short history driving the reactive bloom (see
 * drawRadial / sampleBloom below). `envelope` holds this frame's
 * attack/decay-smoothed value per spectrum band; `history` is a ring buffer
 * of the last RIPPLE_HISTORY_LEN frames of that envelope (`bandCount`
 * values per slot), so outer rings can sample a few frames back and read as
 * a ripple travelling outward from the centre rather than every ring
 * updating in lockstep. `historyPos` is the next slot to write. */
interface BandState {
  bandCount: number;
  envelope: Float32Array;
  history: Float32Array;
  historyPos: number;
}

/** (Re)allocate BandState when the band count changes (a resize) or on
 * first use. Reallocating rather than resizing in place is simplest here:
 * resizes are rare (a ResizeObserver callback, not a per-frame event), and
 * restarting the envelope from silence after one is an inaudible,
 * sub-second visual reset, not a bug. */
function ensureBandState(current: BandState | null, bandCount: number): BandState {
  if (current && current.bandCount === bandCount) return current;
  return {
    bandCount,
    envelope: new Float32Array(bandCount),
    history: new Float32Array(bandCount * RIPPLE_HISTORY_LEN),
    historyPos: 0,
  };
}

/** Advance the envelope one frame toward `target` (this frame's raw
 * spectrumColumns output) — rising at ENVELOPE_ATTACK, falling at the much
 * slower ENVELOPE_DECAY — and snapshot the result into the ripple history.
 * Mutates `state` in place; called once per reactive frame, not per dot. */
function stepBandState(state: BandState, target: readonly number[]): void {
  const { envelope, bandCount, history } = state;
  for (let b = 0; b < bandCount; b++) {
    const value = envelope[b] ?? 0;
    const t = target[b] ?? 0;
    const factor = t > value ? ENVELOPE_ATTACK : ENVELOPE_DECAY;
    envelope[b] = value + (t - value) * factor;
  }
  const slotBase = state.historyPos * bandCount;
  for (let b = 0; b < bandCount; b++) {
    history[slotBase + b] = envelope[b] ?? 0;
  }
  state.historyPos = (state.historyPos + 1) % RIPPLE_HISTORY_LEN;
}

/** Radial mapping for one dot: turn its normalized distance into a
 * (fractional) band index — low bands/bass at the centre, high bands/treble
 * at the rim — then read that band's envelope a few frames back, the delay
 * growing with distance, so a bass hit at the centre visibly washes outward
 * a frame or two later instead of every ring lighting in lockstep.
 * Interpolates between the two nearest bands so rings blend smoothly rather
 * than banding visibly at this grid's fairly coarse band count. */
function sampleBloom(distance: number, state: BandState): number {
  const { bandCount, history, historyPos } = state;
  // Music's energy is concentrated in the lowest bands, so mapping distance
  // to band index linearly lights only the innermost ring and leaves the rest
  // of the field dead. Curving it gives the loud low bands several rings of
  // radius to bloom across, and compresses the sparse treble into the rim.
  const bandPos = Math.pow(distance, BAND_CURVE) * (bandCount - 1);
  const lowBand = Math.min(bandCount - 1, Math.floor(bandPos));
  const highBand = Math.min(bandCount - 1, lowBand + 1);
  const frac = bandPos - lowBand;
  const delay = Math.min(MAX_RIPPLE_DELAY_FRAMES, Math.round(distance * MAX_RIPPLE_DELAY_FRAMES));
  // historyPos is the *next* slot to write, so the most recent frame (delay
  // 0) lives one slot behind it.
  const slot =
    (((historyPos - 1 - delay) % RIPPLE_HISTORY_LEN) + RIPPLE_HISTORY_LEN) % RIPPLE_HISTORY_LEN;
  const slotBase = slot * bandCount;
  const low = history[slotBase + lowBand] ?? 0;
  const high = history[slotBase + highBand] ?? 0;
  return low + (high - low) * frac;
}

/** "pulse" mode (loading/preparing/unreachable), also reused as the
 * permanent shimmer once the reactive tap has been given up on: a single
 * ring expanding from the centre and fading as it nears the rim, then
 * looping. A pure function of a dot's distance and the clock — no spectrum
 * data involved, so it covers the no-tap-yet case too. */
function pulseIntensity(distance: number, now: number): number {
  const phase = (now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS; // 0..1, the ring's current radius
  const ringWidth = 0.18; // normalized-distance thickness of the ring band
  const offset = distance - phase;
  const ring = Math.exp(-(offset * offset) / (2 * ringWidth * ringWidth));
  const fade = 1 - phase; // dims as the ring travels out toward the rim
  return 0.55 * ring * fade;
}

/** Paint the dot field for one frame. Every dot always sits at a faint
 * baseline (DOT_BASE_ALPHA/DOT_RADIUS_RATIO — the idle look), then blooms
 * both brighter and larger with its intensity (0..1 — louder reads as
 * bigger and brighter). `intensity` comes from whichever mode is active:
 *   - "reactive": sampleBloom against the envelope/ripple history
 *   - "pulse": the single travelling ring, a pure function of distance+time
 *   - "idle": always 0 (the static dim field)
 * Radius is capped at DOT_RADIUS_RATIO_PEAK so loud neighbouring dots never
 * visually merge into a blob. */
function drawRadial(
  ctx: CanvasRenderingContext2D,
  grid: Grid,
  mode: "reactive" | "pulse" | "idle",
  now: number,
  bandState: BandState | null,
): void {
  const { cols, rows, width, height, distances } = grid;
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0) return;
  const cellW = width / cols;
  const cellH = height / rows;
  const minCell = Math.min(cellW, cellH);
  const baseRadius = Math.max(0.6, minCell * DOT_RADIUS_RATIO);
  const peakRadius = Math.max(baseRadius, minCell * DOT_RADIUS_RATIO_PEAK);

  // Fill color never changes between dots — only opacity/radius do — so set
  // it once per frame instead of building a fresh rgba() template string
  // per dot (this grid can be hundreds of dots).
  ctx.fillStyle = `rgb(${ACCENT_RGB})`;
  for (let r = 0; r < rows; r++) {
    const cy = cellH * (r + 0.5);
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const distance = distances[i] ?? 0;
      let intensity = 0;
      if (mode === "reactive" && bandState) {
        // Shape before drawing: gamma for dynamics, falloff so the bloom
        // actually reads as radial rather than a uniformly lit field.
        intensity =
          Math.pow(sampleBloom(distance, bandState), BLOOM_GAMMA) *
          (1 - RADIAL_FALLOFF * distance);
      } else if (mode === "pulse") {
        intensity = pulseIntensity(distance, now);
      }
      const cx = cellW * (c + 0.5);
      ctx.globalAlpha = DOT_BASE_ALPHA + (DOT_PEAK_ALPHA - DOT_BASE_ALPHA) * intensity;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius + (peakRadius - baseRadius) * intensity, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function PixelVisualizer({
  audio,
  mode,
  artworkUrl,
}: {
  audio: HTMLAudioElement | null;
  mode: VisualizerMode;
  artworkUrl?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  // The blurred album-art backdrop behind the dot field ("the record is
  // behind the music"). URL rewriting to a high-res variant is pure and
  // lives in src/audio/artwork.ts; this component only tracks which
  // resolved URL (if any) failed to load, so a broken image degrades to
  // today's plain-surface look — dots only, no broken-image icon — rather
  // than leaving that to chance.
  const resolvedArtwork = highResArtwork(artworkUrl);
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  // Placeholder until the first measure: computeGrid's own floor for a
  // zero-sized box, so the smallest grid it can hand out is also the one this
  // starts with.
  const initialGrid = computeGrid(0, 0);
  const gridRef = useRef<Grid>({
    ...initialGrid,
    width: 0,
    height: 0,
    distances: computeDistanceField(initialGrid.cols, initialGrid.rows, 0, 0),
  });
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
      gridRef.current = {
        cols,
        rows,
        width,
        height,
        distances: computeDistanceField(cols, rows, width, height),
      };
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
    // The reactive bloom's per-band envelope/ripple-history state (see
    // BandState above) — reallocated by ensureBandState when the band count
    // changes, dropped back to null whenever the loop isn't drawing the
    // reactive bloom so a later resume starts from silence instead of
    // blooming instantly from a stale envelope.
    let bandState: BandState | null = null;
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
          drawRadial(ctx, grid, "pulse", now, null);
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
            drawRadial(ctx, grid, "pulse", now, null);
          } else {
            const config: SpectrumConfig = { columns: grid.cols, smoothing: SPECTRUM_SMOOTHING };
            prevColumns = spectrumColumns(graph.bins, prevColumns, config);
            bandState = ensureBandState(bandState, grid.cols);
            stepBandState(bandState, prevColumns);
            drawRadial(ctx, grid, "reactive", now, bandState);
          }
        }
      } else {
        prevColumns = null;
        silenceStartedAt = null;
        // Drop the envelope rather than freezing it: a later return to
        // reactive mode should bloom up from silence, not flash back in at
        // whatever intensity it was left at.
        bandState = null;
        drawRadial(ctx, grid, effective === "pulse" ? "pulse" : "idle", now, null);
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
      {resolvedArtwork !== null && resolvedArtwork !== failedArtwork && (
        // Keyed by URL: a track change swaps this element wholesale (a
        // fresh mount, not a re-render of the same node), so the CSS
        // fade-in animation on .audio-stage__backdrop plays fresh every
        // time instead of a double-buffer crossfade system.
        <img
          key={resolvedArtwork}
          src={resolvedArtwork}
          alt=""
          aria-hidden="true"
          className="audio-stage__backdrop"
          onError={() => setFailedArtwork(resolvedArtwork)}
        />
      )}
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
