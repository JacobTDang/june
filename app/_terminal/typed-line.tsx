"use client";

import { useEffect, useState } from "react";
import { typewriterFrame, type TypewriterTiming } from "@/src/lib/typewriter";
import { Cursor, Prompt } from "./primitives";

const TIMING: TypewriterTiming = {
  typeMs: 55,
  holdMs: 2600,
  deleteMs: 22,
  gapMs: 420,
};

/** ~24fps. Faster buys nothing: the line only changes on character boundaries,
 *  and this runs for as long as the page is open. */
const FRAME_MS = 42;

/**
 * A line the page appears to be typing.
 *
 * Under prefers-reduced-motion it settles on the first message and stops —
 * text that rewrites itself forever is exactly what that setting is for.
 */
export function TypedLine({ messages }: { messages: readonly string[] }) {
  const [elapsed, setElapsed] = useState(0);
  const [animate, setAnimate] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setAnimate(!query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!animate) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), FRAME_MS);
    return () => clearInterval(id);
  }, [animate]);

  const text = animate ? typewriterFrame(messages, elapsed, TIMING).text : (messages[0] ?? "");

  return (
    // aria-live off and the whole line hidden from assistive tech: it is
    // decoration, and announcing it character by character would be hostile.
    <p className="typed" aria-hidden>
      <Prompt />
      {text}
      <Cursor />
    </p>
  );
}
