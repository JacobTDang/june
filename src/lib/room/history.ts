"use server";

import { getArtistTopSongs, searchArtists, pickArtistMatch } from "../../discovery";
import { createClient } from "../supabase/server";
import { pickSuggestions, type Suggestable } from "./suggest";

/**
 * The client-callable slice of listening history. Separate from plays.ts on
 * purpose: that module writes with the service role, and a "use server" export
 * is a public endpoint.
 */

/**
 * Something to play when a room's queue has run dry.
 *
 * Built from what the room's listeners actually played: take the artist heard
 * most, ask iTunes for their top songs — the same call the artist view already
 * makes — and drop anything this room has already heard. No recommender, no
 * new dependency, and it works from the first jam rather than needing a corpus.
 */
export async function suggestForRoom(roomId: string, limit = 3): Promise<Suggestable[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Everyone's plays in this room, which the shared-room policy already allows.
  const { data } = await supabase
    .from("plays")
    .select("title, artist, artist_id, played_at")
    .eq("room_id", roomId)
    .order("played_at", { ascending: false })
    .limit(100);

  const rows = (data as { title: string; artist: string | null; artist_id: string | null }[] | null) ?? [];
  if (rows.length === 0) return [];

  // Most-played artist first; ties break toward the more recent, since the
  // rows arrive newest-first.
  const counts = new Map<string, { name: string; artistId: string | null; plays: number }>();
  for (const row of rows) {
    const name = row.artist?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const seen = counts.get(key);
    if (seen) {
      seen.plays += 1;
      seen.artistId ??= row.artist_id;
    } else {
      counts.set(key, { name, artistId: row.artist_id, plays: 1 });
    }
  }

  const ranked = [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, 2);
  if (ranked.length === 0) return [];

  const candidates: Suggestable[] = [];
  for (const artist of ranked) {
    // Tracks added by link or playlist import carry no artist id, so resolve
    // the name the same way the artist chip does.
    let artistId = artist.artistId;
    if (!artistId) {
      const matches = await searchArtists(artist.name, { limit: 5 });
      artistId = pickArtistMatch(artist.name, matches)?.artistId ?? null;
    }
    if (!artistId) continue;
    candidates.push(...(await getArtistTopSongs(artistId)));
  }

  return pickSuggestions({
    candidates,
    playedTitles: rows.map((r) => r.title),
    limit,
  });
}
