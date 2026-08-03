/** Playback volume for this device, kept alongside the play/silent choice in
 *  src/lib/room/playback-mode.ts: both are about how *this* screen behaves,
 *  not about the room everyone shares. */

export const VOLUME_STORAGE_KEY = "june:volume";

/** Below this a level is inaudible in practice, so it reads as off. */
const OFF_THRESHOLD = 0.01;

/** Where the icon switches from one bar to full. */
const LOW_THRESHOLD = 0.5;

export type VolumeLevel = "off" | "low" | "high";

/**
 * The stored level as a 0–1 number, clamped. Anything unparseable means full
 * volume: storage is user-writable and survives releases, and a device left
 * mysteriously silent is a worse failure than a loud one.
 */
export function readVolume(raw: string | null): number {
  const value = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Which of the three states the level reads as, for the icon. */
export function volumeLevel(volume: number): VolumeLevel {
  if (volume < OFF_THRESHOLD) return "off";
  return volume < LOW_THRESHOLD ? "low" : "high";
}
