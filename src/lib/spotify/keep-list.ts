import type { PinService, PinsReplaced } from "../../audio/pins";

/**
 * The keep list: every matched video in anyone's library, sent to mp3server
 * so it keeps that audio at home and fetches it ahead of time. The whole set
 * goes every run, so a missed run corrects itself on the next. Written
 * against two interfaces so it's tested with fakes; the Supabase store is
 * ./keep-list-store.ts.
 */

export interface KeepListStore {
  libraryVideoIds(): Promise<string[]>;
}

export async function sendKeepList(store: KeepListStore, pins: PinService): Promise<PinsReplaced> {
  return pins.replacePins(await store.libraryVideoIds());
}
