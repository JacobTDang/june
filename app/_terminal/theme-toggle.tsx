"use client";

import { useEffect } from "react";
import { REVEALING_ATTR } from "@/src/lib/reveal";
import { STORAGE_KEY, nextTheme, readTheme } from "@/src/lib/theme";
import type { Theme } from "@/src/lib/theme";



/** Paint a theme and tell the browser chrome about it, so the mobile address
 *  bar matches the page instead of staying on last render's colour. */
function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // The layout's tag carries the default theme. Rewrite it to whatever is
  // actually on screen, and drop any duplicate so the browser cannot pick a
  // different one - it takes the first tag whose media matches.
  const color = theme === "dark" ? "#0b0c11" : "#f4f3ee";
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  for (const extra of metas.slice(1)) extra.remove();
  const meta = metas[0] ?? document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.removeAttribute("media");
  meta.setAttribute("content", color);
  if (!meta.isConnected) document.head.appendChild(meta);
}

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * Switches between paper and ink.
 *
 * Both labels are rendered and CSS picks which one shows, so the button is
 * correct in the server's HTML without the client knowing the theme yet -
 * reading it during render would either mismatch on hydration or flash the
 * wrong word. The boot script in layout.tsx has already stamped data-theme by
 * the time this paints.
 */
export function ThemeToggle() {
  useEffect(() => {
    // The boot script set data-theme but cannot tidy the metadata tags, which
    // React had not rendered yet at that point.
    apply(readTheme(safeRead()));
  }, []);

  return (
    <button
      type="button"
      className="btn btn--sm theme-toggle"
      onClick={() => {
        const theme = nextTheme(current());
        try {
          localStorage.setItem(STORAGE_KEY, theme);
        } catch {
          // Private mode can refuse to store. The switch still applies for
          // this page - it just won't be remembered - which beats refusing to
          // change the theme at all.
        }

        const start = document.startViewTransition?.bind(document);
        if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          // No View Transitions, or the viewer asked for stillness: switch
          // outright rather than degrading to a half-animation.
          apply(theme);
          return;
        }
        // Tell the canvases to stand down for the duration. They are behind
        // the transition's snapshots and cannot be seen, but they can still
        // starve a clip-path animation, which has no compositor fast path.
        const de = document.documentElement;
        de.setAttribute(REVEALING_ATTR, "");
        const transition = start(() => apply(theme));
        const revive = () => de.removeAttribute(REVEALING_ATTR);
        // finished rejects on a skipped transition; the canvases have to come
        // back either way, or the room quietly stops animating.
        transition.finished.then(revive, revive);
      }}
    >
      <span className="theme-toggle__to-dark">Dark</span>
      <span className="theme-toggle__to-light">Light</span>
    </button>
  );
}

function safeRead(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked outright; the default theme still applies.
    return null;
  }
}
