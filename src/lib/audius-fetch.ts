"use server";

import { AUDIUS_HOST, parseAudiusTrack, type AudiusTrack } from "./audius";

/** Trending Audius tracks, or search results for a query. Public data, no auth. */
export async function getAudiusTracks(query?: string): Promise<AudiusTrack[]> {
  const q = query?.trim();
  const url = q
    ? `${AUDIUS_HOST}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=june`
    : `${AUDIUS_HOST}/v1/tracks/trending?app_name=june&limit=20`;

  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Audius returned ${res.status}`);

  const json = (await res.json()) as { data?: unknown[] };
  return (json.data ?? [])
    .map((t) => parseAudiusTrack(t))
    .filter((t): t is AudiusTrack => t !== null);
}
