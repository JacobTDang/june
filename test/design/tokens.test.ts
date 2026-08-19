import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The stylesheet had 27 font sizes and 38 spacing values — 0.78 next to 0.8
 *  next to 0.82, each nudged by eye in its own component. Nothing lined up
 *  between components, which is what reads as unconsidered. These tests hold
 *  the scales in place: a size has to be a step, not a guess. */

const CSS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** Declarations, with the `:root` token block itself excluded — that is where
 *  the raw values are supposed to live. */
function declarations(prop: RegExp): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  const stack: string[] = [];
  for (const raw of CSS.split("\n")) {
    const line = raw.trim();
    if (line.endsWith("{")) {
      stack.push(line.slice(0, -1).trim());
      continue;
    }
    if (line.startsWith("}")) {
      stack.pop();
      continue;
    }
    if (stack.some((s) => s === ":root")) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.+?);/);
    if (m?.[1] && m[2] && prop.test(m[1])) out.push({ selector: stack.join(" "), value: m[2] });
  }
  return out;
}

describe("type scale", () => {
  it("sizes text from the scale, never from a loose value", () => {
    const loose = declarations(/^font-size$/).filter(
      ({ value }) => !value.startsWith("var(--text-") && value !== "inherit",
    );
    expect(loose.map((d) => `${d.selector} { font-size: ${d.value} }`)).toEqual([]);
  });
});

describe("space scale", () => {
  // Sub-grid px are the hairlines a grid can't express: a 1px rule, a 2px
  // optical nudge on an icon. Anything larger is spacing and belongs to a step.
  const ALLOWED = /^(0|auto|inherit|100%|[0-2]px)$/;

  // calc() counts as on-scale only while every length inside it is a step —
  // that is how a negative margin stays tied to the step it mirrors.
  const onScale = (value: string) =>
    value
      .replace(/calc\((?:[^()]|\([^()]*\))*\)/g, (expr) =>
        /var\(--space/.test(expr) && !/[0-9.]+(rem|em|px|%)/.test(expr) ? "var(--space-calc)" : expr,
      )
      .split(/\s+/)
      .every((part) => part.startsWith("var(--space") || ALLOWED.test(part));

  it("spaces from the scale, never from a loose value", () => {
    const loose = declarations(
      /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/,
    ).filter(({ value }) => !onScale(value));
    expect(loose.map((d) => `${d.selector} { ${d.value} }`)).toEqual([]);
  });
});

describe("tracking and leading", () => {
  it("tracks and leads from the scales", () => {
    const loose = [
      ...declarations(/^letter-spacing$/).filter(({ value }) => !value.startsWith("var(--track-")),
      ...declarations(/^line-height$/).filter(
        ({ value }) => !value.startsWith("var(--leading-") && value !== "inherit" && value !== "1",
      ),
    ];
    expect(loose.map((d) => `${d.selector} { ${d.value} }`)).toEqual([]);
  });
});

describe("components", () => {
  it("keeps inline styles on the scales", () => {
    const files = execSync("git ls-files 'app/*.tsx' 'src/*.tsx'", { encoding: "utf8" })
      .trim()
      .split("\n");
    const loose: string[] = [];
    for (const file of files) {
      readFileSync(join(process.cwd(), file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes("style={{")) return;
          // Only string literals: a computed size (an avatar's initials scaling
          // with its diameter) is a different thing from a hardcoded step.
          for (const [, prop, value] of line.matchAll(
            /(fontSize|padding|margin|gap)[A-Za-z]*:\s*"([^"]+)"/g,
          )) {
            if (value && !value.includes("var(--")) loose.push(`${file}:${i + 1} ${prop}: ${value}`);
          }
        });
    }
    expect(loose).toEqual([]);
  });
});
