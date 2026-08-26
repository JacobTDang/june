"use client";

import { useEffect } from "react";
import {
  STORAGE_KEY,
  coverRadius,
  nextChoice,
  readChoice,
  resolveTheme,
} from "@/src/lib/theme";
import type { Theme } from "@/src/lib/theme";

/** Long enough to read as a sweep, short enough not to sit in the way. */
const REVEAL_MS = 520;

/** Paint a theme and tell the browser chrome about it, so the mobile address
 *  bar matches the page instead of staying on last render's colour. */
function apply(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // The layout ships two media-scoped theme-color tags so a browser with no
  // JS still matches the OS. Once we know the actual theme those are stale:
  // collapse them to one unscoped tag, since a browser takes the first tag
  // whose media matches and we want ours to be the one that does.
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
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
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
    apply(current());

    // While no explicit choice is stored the page keeps following the OS, so
    // switching the system theme moves june with it in the same instant.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readChoice(localStorage.getItem(STORAGE_KEY)) !== "system") return;
      apply(resolveTheme("system", mq.matches));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <button
      type="button"
      className="btn btn--sm theme-toggle"
      onClick={(event) => {
        const choice = nextChoice(current());
        const theme = resolveTheme(choice, false);
        try {
          localStorage.setItem(STORAGE_KEY, choice);
        } catch {
          // Private mode can refuse to store. The switch still applies for
          // this page - it just won't be remembered - which beats refusing to
          // change the theme at all.
        }

        // Grow the new theme out of the button that asked for it. Measured
        // before the swap, because applying the theme is what moves the page.
        const box = event.currentTarget.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;

        const start = document.startViewTransition?.bind(document);
        if (!start || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          // No View Transitions, or the viewer asked for stillness: switch
          // outright rather than degrading to a half-animation.
          apply(theme);
          return;
        }

        const transition = start(() => apply(theme));
        void transition.ready
          .then(() => {
            const r = coverRadius(x, y, window.innerWidth, window.innerHeight);
            document.documentElement.animate(
              {
                clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`],
              },
              {
                duration: REVEAL_MS,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                pseudoElement: "::view-transition-new(root)",
              },
            );
          })
          .catch(() => {
            // ready rejects when the browser skips the transition - a second
            // click landing mid-reveal, say. The theme has already been
            // applied by the callback, so there is nothing to recover.
          });
      }}
    >
      <span className="theme-toggle__to-dark">Dark</span>
      <span className="theme-toggle__to-light">Light</span>
    </button>
  );
}
