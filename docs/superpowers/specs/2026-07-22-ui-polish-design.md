# june UI polish — design

Approved decisions: add **motion** (framer-motion, v12; `motion/react`; React 19
compatible — verified). Room layout = **queue-left / player-right / people-bottom**.
Playlists = **3-card carousel + name search on the in-room tab** (leave `/playlists`
page as-is). Ship as **three sequential PRs** (each merged before the next branches,
because PR 3 depends on motion from PR 2).

Keep the locked design system throughout: warm near-black (`--bg #100f12`), single
amber accent (`--accent #f2b552`), Fraunces display serif, one radius (8px), the
`--ease` cubic-bezier, restraint ("no pills, no glow"). Respect
`prefers-reduced-motion` (already globally handled — motion must honor it too).

---

## PR 1 — OAuth graceful degradation

**Root cause (verified):** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are empty in
`.env.local`. Google *sign-in* works (Supabase's provider), but refreshing the
YouTube access token calls Google directly (`google-oauth.ts` →
`refreshAccessToken`) and throws "Google OAuth is not configured" when the creds
are blank. This surfaces to the user as a raw error string when the 1-hour token
expires and any YouTube feature (playlists) runs.

**Config (user's action, documented not coded):** paste the real client id/secret
(the same pair configured in the Supabase Google provider / Google Cloud Console)
into `.env.local`, restart dev. Secrets can't be set by the agent.

**Code (this PR):**
- Add a pure predicate `youTubeConfigError(message)` or a typed error so callers
  can distinguish "not configured / not connected / needs reconnect" from a real
  failure. Simplest: a small pure helper `describeYouTubeError(err): { kind:
  "not-configured" | "not-connected" | "failed"; message: string }` (import-clean,
  TDD'd).
- In the in-room "My playlists" tab and the `/playlists` page, render a calm
  "Connect YouTube" / "YouTube isn't set up yet" state for the not-configured and
  not-connected kinds, instead of echoing the raw exception. Fail loud stays for
  genuine failures (`failed` kind shows the message).
- No behavior change to the happy path.

**Tests:** `describeYouTubeError` pure unit tests (each kind). UI states verified
via build + manual.

---

## PR 2 — Interaction feel + homepage (introduces motion)

**Dependency:** `npm i motion`. Import from `motion/react`.

**Button feel.** The "slow and rigid" complaint is server-action latency with only
a disabled state. Introduce a shared client `Button` (and/or `motion.button`
wrapper) that:
- Springs on press (`whileTap={{ scale: 0.97 }}`) and lifts subtly on hover.
- Shows an inline in-flight indicator (small spinner / pulsing dot) while its
  async handler runs, so a press registers instantly regardless of round-trip.
- Is a thin wrapper over the existing `.btn` classes — variants (`primary`,
  `sm`, `lg`) preserved; existing call sites migrate incrementally (primary
  actions first). Non-migrated `.btn` usages keep working.
- Honors `prefers-reduced-motion` (motion's `useReducedMotion` disables the
  spring).

**Homepage.** Keep the june wordmark and the character-waves background. Replace
the em-dash sub-copy ("Sign in to start a room — your friends join with a code.")
with dash-free phrasing ("Sign in to start a room. Friends join with a code.").
Add a staggered entrance (wordmark → lead → button) via motion, replacing the
single `.rise` fade. Primary sign-in uses the new springy button.

**Tests:** any extracted copy/entrance constants are trivial; the Button's async
in-flight logic (a pure state reducer, e.g. `nextButtonState`) is TDD'd if
extracted. Motion visuals via build + manual.

---

## PR 3 — Room redesign + drag reorder + playlist carousel

### Layout
Restructure the room into: a two-column grid — **left** = Up next (queue),
**right** = player + now-playing + add-music — with **In the room** (participants)
as a full-width strip below both. Single stacked column under ~720px. The queue is
a **~5-song window**: `max-height` ≈ 5 rows, `overflow-y: auto`.

### Drag-to-reorder (backend change)
`move_queue_item` only swaps neighbors, which can't express an arbitrary drag.
Add:
- **SQL** `reorder_queue(p_room text, p_item_ids uuid[])` — SECURITY DEFINER,
  `set search_path = ''`, participant-checked via `is_room_participant`. Verifies
  every id belongs to the room, then rewrites `position` to the given order
  (positions from `nextval` or a monotonic reassignment 1..N scaled to avoid
  collisions). Grant execute to `authenticated` only; revoke from public/anon.
  Migration + TDD via the rolled-back-transaction pattern (assert final order;
  reject a non-participant; reject ids from another room).
- **Server action** `reorderQueue(roomId, orderedIds: string[])` calling the RPC.
- **UI**: queue becomes a motion `<Reorder.Group axis="y" values={queue}>` with a
  drag handle per row; on drag end, optimistic local reorder + `reorderQueue`
  persists; realtime reconciles. Remove the up/down buttons (drag replaces them);
  keep the `X` remove. Reorder is disabled while a persist is in flight to avoid
  races.

Keep `move_queue_item` in place (unused by the new UI but harmless) or remove it
with its migration note — decided in the plan; default keep to avoid churn.

### Playlist carousel (in-room "My playlists" tab)
Replace the full list with:
- A name-filter `input` (client-side filter over the loaded playlists).
- A **3-card window**: cards (cover, title, count), left/right arrows + swipe to
  page through in groups of 3; motion slides between pages.
- Tapping a card opens its songs (existing `openPlaylist` flow, unchanged).
- The windowing + filtering is a **pure function** `playlistWindow(playlists,
  query, page, size=3): { cards, page, pageCount }` — TDD'd (filter by name
  case-insensitively, clamp page, compute pageCount, slice the window).

**Tests:** `reorder_queue` SQL (rolled-back txn), `playlistWindow` pure unit
tests. Motion drag/carousel via build + manual click-through.

---

## Cross-cutting

- **Testing discipline:** TDD every pure helper and the SQL function before wiring
  UI. Motion-driven visuals aren't unit-tested (consistent with existing UI code);
  verified by `tsc`, `next build`, and the user's click-through.
- **Reduced motion:** every motion animation gated by `useReducedMotion`.
- **No silent fallbacks:** graceful YouTube states are explicit, not error-swallowing;
  genuine failures still surface.
- **Sequencing:** PR1 → merge → PR2 → merge → PR3 → merge. Each branches from
  updated main.
