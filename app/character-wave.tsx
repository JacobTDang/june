"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * Character Waves - a field of monospace glyphs driven by layered pseudo-noise
 * with cursor ripples. Component from OriginKit (originkit.dev), adapted here for
 * Next.js / React 19: Framer's RenderTarget removed, `defaultProps` converted to
 * default params, made a transparent click-through overlay, throttled, and
 * reduced-motion aware.
 */

type Direction = "left" | "right" | "top" | "bottom";

export interface CharacterWaveProps {
  characters?: string;
  elementSize?: number;
  color?: string;
  direction?: Direction;
  invert?: boolean;
  waveTension?: number;
  speed?: number;
  noiseScale?: number;
  intensity?: number;
  hasCursorInteraction?: boolean;
  interactionIntensity?: number;
  interactionRadius?: number;
  fontWeight?: string;
  style?: CSSProperties;
}

export function CharacterWave({
  characters = " °•◦○◉●",
  elementSize = 16,
  color = "#ffffff",
  direction = "left",
  invert = false,
  waveTension = 5,
  speed = 20,
  noiseScale = 12,
  intensity = 10,
  hasCursorInteraction = true,
  interactionIntensity = 15,
  interactionRadius = 160,
  fontWeight = "400",
  style,
}: CharacterWaveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const ramp = (() => {
    const base = characters && characters.length > 0 ? characters : " .:-+*=%@#";
    const chars = base.split("");
    return (invert ? chars.reverse() : chars).join("");
  })();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({
          w: Math.max(1, Math.floor(cr.width)),
          h: Math.max(1, Math.floor(cr.height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track the pointer on the window so ripples work even under a click-through layer.
  useEffect(() => {
    if (!hasCursorInteraction) return;
    const onMove = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => {
      pointerRef.current.active = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [hasCursorInteraction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h } = size;
    if (w === 0 || h === 0) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const speedVal = speed / 20;
    const tensionVal = waveTension / 10;
    const twistVal = 0.1;
    const scaleVal = noiseScale / 100;
    const intensityVal = intensity / 10;
    const cursorForceVal = interactionIntensity / 10;

    const drift: Record<Direction, [number, number]> = {
      left: [1, 0],
      right: [-1, 0],
      top: [0, 1],
      bottom: [0, -1],
    };
    const [driftX, driftY] = drift[direction] ?? drift.left;
    const driftRate = 1.5;

    const cell = Math.max(4, elementSize);
    const colStep = cell * 0.6;
    const cols = Math.ceil(w / colStep) + 1;
    const rows = Math.ceil(h / cell) + 1;

    ctx.font = `${fontWeight} ${cell}px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const noise = (x: number, y: number, t: number) => {
      const a = Math.sin(x * 1.3 + t) * Math.cos(y * 1.1 - t * 0.7);
      const b = Math.sin((x + y) * 0.7 + t * 0.5);
      const c = Math.sin(x * 0.4 - y * 0.6 + t * 0.3);
      return (a + b + c) / 3;
    };

    const rampMax = ramp.length - 1;
    if (startRef.current === 0) startRef.current = performance.now();

    const draw = (now: number) => {
      const t = ((now - startRef.current) / 1000) * speedVal;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      const p = pointerRef.current;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const px = i * colStep;
          const py = j * cell;
          const ox = t * driftRate * driftX;
          const oy = t * driftRate * driftY;
          const nx = i * scaleVal + ox + Math.sin((j + t) * twistVal) * 2;
          const ny = j * scaleVal + oy + Math.cos((i + t) * twistVal) * 2;
          let v = noise(nx, ny, t * tensionVal);
          if (hasCursorInteraction && p.active) {
            const dx = px - p.x;
            const dy = py - p.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < interactionRadius) {
              const falloff = 1 - d / interactionRadius;
              v += Math.sin(d * 0.08 - t * 4) * falloff * cursorForceVal;
            }
          }
          const norm = Math.max(0, Math.min(1, (v * intensityVal + 1) / 2));
          const ch = ramp.charAt(Math.round(norm * rampMax));
          if (ch !== " ") ctx.fillText(ch, px, py);
        }
      }
    };

    if (reduce) {
      draw(startRef.current + 1000);
      return;
    }

    let lastDraw = 0;
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastDraw < 33) return; // ~30fps is plenty for ambient texture
      lastDraw = now;
      draw(now);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [
    size,
    characters,
    elementSize,
    color,
    direction,
    ramp,
    waveTension,
    speed,
    noiseScale,
    intensity,
    hasCursorInteraction,
    interactionIntensity,
    interactionRadius,
    fontWeight,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ ...style, position: "relative", overflow: "hidden", width: "100%", height: "100%" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

/** june's fixed, click-through background using Character Waves, tuned subtle. */
export function WavesBackground() {
  return (
    <div className="bg-waves" aria-hidden="true">
      <CharacterWave
        color="rgba(242, 181, 82, 0.11)"
        elementSize={22}
        speed={12}
        direction="top"
        waveTension={4}
        noiseScale={12}
        intensity={8}
        interactionRadius={200}
        interactionIntensity={16}
      />
    </div>
  );
}
