import { createServiceClient } from "../supabase/service";
import { pacificDay } from "./day";

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

/** YouTube Data API cost per endpoint, in quota units. `search` is the pricey one. */
export const ENDPOINT_COST: Record<string, number> = {
  search: 100,
  videos: 1,
  playlists: 1,
  playlistItems: 1,
};

/** The costed endpoint for a request URL (the last path segment), or null. */
export function endpointOf(url: URL): string | null {
  const seg = url.pathname.split("/").filter(Boolean).pop() ?? "";
  return seg in ENDPOINT_COST ? seg : null;
}

async function record(endpoint: string, units: number): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("record_youtube_units", {
      p_day: pacificDay(),
      p_endpoint: endpoint,
      p_units: units,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    // Metering must never break the actual feature — surface it, don't throw.
    console.error("[metrics] failed to record YouTube units:", e);
  }
}

/**
 * Wrap the YouTube client's fetch so every real API request is metered into
 * youtube_usage. Recording is fire-and-forget: it never delays or fails the call.
 */
export function meteredFetch(base: FetchLike = (url, init) => fetch(url, init)): FetchLike {
  return async (url, init) => {
    const response = await base(url, init);
    const endpoint = endpointOf(url);
    if (endpoint) void record(endpoint, ENDPOINT_COST[endpoint]!);
    return response;
  };
}
