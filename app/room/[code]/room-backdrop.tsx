"use client";

import { useCallback, useEffect, useState } from "react";
import { DitheredField } from "@/app/_terminal/dithered-field";
import { highResArtwork } from "@/src/audio/artwork";
import type { RoomNowPlaying } from "@/src/lib/room/types";

/** Shown before anything is playing, and whenever artwork cannot be read. */
const DEFAULT_FIELD = "/backdrops/field-01.png";

/**
 * The room takes on the current track's artwork, dithered.
 *
 * This is the room's whole atmosphere: when a track starts, the page becomes a
 * one-bit rendering of its cover, and changes when the music does. Before
 * anything plays it falls back to the house field, so an empty room still has
 * a ground rather than a blank rectangle.
 */
export function RoomBackdrop({ nowPlaying }: { nowPlaying: RoomNowPlaying | null }) {
  const artwork = highResArtwork(nowPlaying?.thumbnailUrl);
  const [failed, setFailed] = useState<string | null>(null);

  // A new track deserves a fresh attempt: the previous one may have failed for
  // reasons specific to its own host.
  useEffect(() => setFailed(null), [artwork]);

  const onFail = useCallback((reason: string) => {
    // Loud, but not fatal: the room stays usable on the house field, and the
    // reason is recoverable from the console rather than being guessed at.
    console.warn(`[room backdrop] ${reason}`);
    setFailed(reason);
  }, []);

  const src = artwork && !failed ? artwork : DEFAULT_FIELD;
  // Artwork is busier than the house field, so it is pushed a little darker —
  // the paper cards have to stay readable on top of it.
  return <DitheredField src={src} gamma={src === DEFAULT_FIELD ? 0.85 : 1.05} onFail={onFail} />;
}
