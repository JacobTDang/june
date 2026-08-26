# june: monochrome terminal UI

## Goal

Replace june's dark amber-accented interface with a light, monochrome,
terminal-flavoured one: Geist Mono throughout, ASCII-derived controls, and a
dithered black-and-white photographic backdrop.

Reference: the MHacks 2026 dashboard — a halftoned photo behind a floating
cream card, monospace type, `[x]` checkboxes, a block cursor, corner tick
marks and dot-density rules.

## Direction (decided)

| Decision | Choice |
| --- | --- |
| Base | **Light.** Paper surfaces, black ink, backdrop behind. A full inversion of today's `--bg: #100f12`. |
| Terminal styling | **Full commitment.** Mono everywhere, ASCII controls, corner ticks, dot rules. |
| Backdrop | **Curated dithered photos app-wide; dithered album art in the room.** |
| Dither algorithm | **Bayer 4×4, dispersed**, at native resolution. |

## What the dither actually is

Established by prototype rather than assumption — four strategies were built
and compared against the reference at pixel level:

| Strategy | Result |
| --- | --- |
| Atkinson | Discards 2/8 of its error; crushes midtones to near-black speckle. Rejected. |
| Floyd–Steinberg | Organic, irregular clusters with no lattice. Does not resemble the reference. Rejected. |
| Clustered-dot screen | Regular lattice of plus/cross marks — a printed halftone look. Close, but coarser than wanted. |
| **Bayer 4×4 dispersed** | Fine regular crosshatch lattice. **Chosen.** |

Two parameters matter as much as the algorithm:

- **Native resolution.** An early attempt dithered at 200px and upscaled with
  `image-rendering: pixelated`, which produced chunky blocks. The screen must
  run at the image's own resolution so the lattice stays fine.
- **Normalisation before thresholding.** Ordered dithering thresholds against
  a fixed matrix, so input tone decides everything. Greyscale → auto-levels →
  gamma (≈0.85) puts the mass into the midtones, which is where the lattice
  has texture to give.

### Pipeline

```
luminance  →  auto-levels (stretch to full range)
           →  gamma 0.85 (bias toward midtones)
           →  Bayer 4×4 threshold
           →  1-bit output
```

## Architecture

### `src/visual/dither.ts` — pure pixel math

No DOM. Takes and returns `ImageData`-shaped data, so it is unit-testable the
same way the server's matching logic is.

```ts
export function bayerMatrix(n: 2 | 4 | 8): number[][];
export function autoLevels(gray: Float32Array): void;   // in place
export function ditherOrdered(
  gray: Float32Array, width: number, height: number, matrix: number[][],
): void;                                                 // in place, → 0|255
```

Matrix size stays a parameter rather than a constant: 4×4 is the chosen
default, but the right value is judged against real backgrounds, and the
room may want a different value from the page.

### `src/visual/backdrop.tsx` — one component, two consumers

`<DitheredBackdrop src cover />` renders to a canvas, redithers on resize
(debounced), and respects `prefers-reduced-motion` by not re-rendering on
track change.

- App-wide: a small set of curated high-contrast images in `public/backdrops/`.
- Room: the current track's artwork via the existing `highResArtwork`.

Album art is deliberately *not* the global backdrop. Prototyping showed covers
vary too widely — a pale cover dithers into a light field that suits a light
UI, a dark one stays dark through auto-levels and gamma, because stretching
cannot invent range an image lacks. Curated images give predictable contrast;
the room can take a dark field because a dark stage suits a player.

### Tokens — the main lever

`app/globals.css`'s `:root` already declares 58 custom properties and
describes itself as "near-monochrome … a single amber accent". The revamp is
largely re-pointing those.

```css
--bg:        #f4f3ee;   /* paper */
--surface:   #ffffff;   /* panel */
--surface-2: #eeece5;
--ink:       #111111;
--muted:     #666666;
--faint:     #999999;
--line:      #e6e4dd;
--line-2:    #cfccc2;
--r:         0;         /* terminal has no rounded corners */
--r-sm:      0;
```

`--accent` is **deleted, not recoloured.** It currently marks live state,
progress and focus. In a monochrome terminal system that job belongs to
*inversion* — a filled black block, a blinking cursor, a reversed label — not
to a hue. Every current `--accent` use site gets an inversion treatment
instead.

### Terminal primitives

Small, dependency-free components in `app/_terminal/`:

| Component | Renders |
| --- | --- |
| `<Tick>` | corner bracket mark |
| `<DotRule>` | dot-density gradient rule |
| `<AsciiCheck checked>` | `[x]` / `[ ]` |
| `<Cursor>` | blinking block |
| `<Prompt>` | `>` prefix |

### Typography

Geist Mono via `next/font/google` — no new dependency, no layout shift.
The existing six-step scale is kept; mono runs wider, so `--text-root` drops
from 15px and the scale is re-tuned against real content rather than by ratio.

## Phasing

Eight surfaces and 35 components is too much for one plan.

1. **Foundation** — tokens, Geist Mono, `dither.ts` + `<DitheredBackdrop>`,
   terminal primitives, and the home page converted as proof.
2. **Surfaces** — `/friends`, `/playlists`, `/profile`, `/u/[username]`,
   `/metrics`, `/labs/audius` against the established vocabulary.
3. **The room** — player, visualizer, lyrics, chat, **and a layout change**.

### Room layout (Phase 3)

Today the room is three columns —
`minmax(220px,250px) | 1fr | minmax(310px,350px)` — queue, stage, rail
(people + chat). The stage sits in the middle, which gives the album art the
least room of the three.

The new arrangement puts the artwork first:

- **Left:** album art, large, with the audio visualizer on or around it.
- **Right:** song selection and chat.
- Content continues **beneath** the artwork rather than the left column
  ending where the art does.

One ambiguity to settle before this phase starts: whether "spread under the
album art" means the *right-hand* column's content wraps beneath the artwork
once it runs past the art's height, or whether the *left* column gains its own
stack (now-playing meta, queue) underneath the art. These produce different
grids and different responsive behaviour, so it is a question to answer with
mockups at the start of Phase 3, not a detail to infer now.

The room is last deliberately. `PixelVisualizer` draws amber dots on dark;
inverted it becomes dark dots on light, which is the same visual language as
the backdrop. That is an opportunity, but it is a rethink rather than a
recolour, and it should happen once the vocabulary is settled.

## Risks

- **Mono hurts long prose.** Chat and lyrics are the exposure. Mitigated with
  a larger size, looser line-height and a tighter measure rather than by
  quietly substituting a sans. If it still reads badly in Phase 3, that is the
  point to revisit — not before.
- **Per-frame cost in the room.** Redithering album art on every track change
  is fine; redithering on every animation frame is not. The backdrop redraws
  on source change and on debounced resize only.
- **Contrast against an uncontrolled backdrop.** Cards carry an opaque fill
  and a hard rule so they hold against either tonal extreme.
- **Eight surfaces is a lot of churn.** Phase 1 exists to make the direction
  judgeable on one real page before the other seven move.

## Verification

- `npx tsc --noEmit && npm test` green; `dither.ts` covered by unit tests over
  known inputs (a flat mid-grey field must produce a regular lattice; a pure
  black and a pure white field must produce no dots at all).
- Home page screenshotted against the reference at matching zoom, checking the
  lattice reads as fine crosshatch and not as chunky blocks.
- Contrast checked against both a pale and a dark backdrop.
- `prefers-reduced-motion` honoured: no re-dither on track change.
