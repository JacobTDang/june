/**
 * Pure rendering + selection math for the admin CLI's interactive room picker,
 * kept here so it's unit-testable without a TTY. The raw-mode key loop that uses
 * these lives in scripts/admin.ts.
 */

export interface RoomChoice {
  id: string;
  nowPlaying: string; // pre-formatted, e.g. "▶ Title — Artist" or "idle"
  here: number;
}

const ESC = String.fromCharCode(27);
const REVERSE = `${ESC}[7m`;
const RESET = `${ESC}[0m`;

/** Move a selection by delta and clamp to the list (no wrap-around). */
export function clampIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, current + delta));
}

/** Render the room list with one row highlighted (reverse video + ❯ marker). */
export function renderRoomPicker(rooms: RoomChoice[], selected: number): string {
  return rooms
    .map((r, i) => {
      const line = `${r.id.padEnd(12)} ${String(r.here).padStart(2)} here   ${r.nowPlaying}`;
      return i === selected ? `${REVERSE} ❯ ${line} ${RESET}` : `   ${line}`;
    })
    .join("\n");
}
