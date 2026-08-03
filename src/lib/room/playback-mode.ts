/** Whether this particular device plays the room's audio. A jam is often open
 *  on more than one screen — a laptop and a phone — and only one of them
 *  should make sound; the others follow the room (queue, chat, what's on)
 *  in silence. The choice is per device, so it lives in localStorage rather
 *  than in the room's shared state. */

export type PlaybackMode = "play" | "silent";

export const PLAYBACK_MODE_STORAGE_KEY = "june:playback-mode";

/**
 * The stored choice, defaulting to playing. Anything unrecognised also means
 * play: storage is user-writable and outlives releases, and a device left
 * mysteriously silent is a worse failure than one that makes sound.
 */
export function readPlaybackMode(raw: string | null): PlaybackMode {
  return raw === "silent" ? "silent" : "play";
}

/** The single condition for this device driving the audio element. */
export function shouldPlayHere(mode: PlaybackMode, started: boolean, hasTrack: boolean): boolean {
  return mode === "play" && started && hasTrack;
}
