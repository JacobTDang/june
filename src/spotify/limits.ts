/** The largest page every Spotify endpoint june reads accepts. */
export const SPOTIFY_PAGE_SIZE = 50;

/** recently-played keeps only this many plays, whatever the cursor says. */
export const RECENTLY_PLAYED_LIMIT = 50;

export type TimeRange = "short_term" | "medium_term" | "long_term";

/** Spotify's three windows for top items: ~4 weeks, ~6 months, ~1 year. */
export const TIME_RANGES: readonly TimeRange[] = ["short_term", "medium_term", "long_term"];
