import { createClient } from "../supabase/server";
import type { SpotifyStatusView } from "./messages";

/**
 * What /library shows. Read with the signed-in user's own client, so RLS
 * scopes every row to them; the connection status comes through
 * my_spotify_connection(), which never returns tokens.
 */

export interface SpotifyStatus extends SpotifyStatusView {
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface LibrarySong {
  title: string;
  artists: string[];
  artworkUrl: string | null;
  /** When it was liked or played. */
  at: string;
}

export interface LibraryPlaylist {
  id: string;
  name: string;
  artworkUrl: string | null;
  songCount: number;
}

type SongJoin = { title: string; artists: string[]; artwork_url: string | null } | null;

function toLibrarySong(song: SongJoin, at: string): LibrarySong {
  // song_id is a non-null foreign key, so a missing song is a broken read.
  if (song === null) throw new Error("library row came back without its song");
  return { title: song.title, artists: song.artists, artworkUrl: song.artwork_url, at };
}

export async function getSpotifyStatus(): Promise<SpotifyStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_spotify_connection");
  if (error) throw new Error(`read Spotify connection: ${error.message}`);
  const row = ((data ?? []) as {
    display_name: string | null;
    status: "active" | "revoked";
    last_synced_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
  }[])[0];
  if (!row) return null;
  return {
    displayName: row.display_name,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
  };
}

export async function getLikedSongs(
  userId: string,
  limit: number,
): Promise<{ songs: LibrarySong[]; total: number }> {
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("library_songs")
    .select("added_at, songs(title, artists, artwork_url)", { count: "exact" })
    .eq("user_id", userId)
    .order("added_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`read liked songs: ${error.message}`);
  const rows = (data ?? []) as unknown as { added_at: string; songs: SongJoin }[];
  return { songs: rows.map((r) => toLibrarySong(r.songs, r.added_at)), total: count ?? rows.length };
}

export async function getLibraryPlaylists(userId: string): Promise<LibraryPlaylist[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playlists")
    .select("id, name, artwork_url, song_count")
    .eq("user_id", userId)
    .order("name");
  if (error) throw new Error(`read playlists: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; artwork_url: string | null; song_count: number }[]).map(
    (p) => ({ id: p.id, name: p.name, artworkUrl: p.artwork_url, songCount: p.song_count }),
  );
}

export async function getRecentListens(userId: string, limit: number): Promise<LibrarySong[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listens")
    .select("played_at, songs(title, artists, artwork_url)")
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`read recent listens: ${error.message}`);
  const rows = (data ?? []) as unknown as { played_at: string; songs: SongJoin }[];
  return rows.map((r) => toLibrarySong(r.songs, r.played_at));
}
