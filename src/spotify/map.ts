import type { PlaylistSummary, SpotifyTrack, TopArtist } from "./schema";

/** A `songs` row as the sync writes it. The match columns are left out on
 *  purpose: an upsert must never reset a song that has already been matched. */
export interface SongRow {
  source: "spotify";
  source_id: string;
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number | null;
  artwork_url: string | null;
}

/**
 * A Spotify track as a song, or null for what june can't use: local files
 * (no Spotify id), podcast episodes, and anything without an artist to match
 * on. Spotify lists album art largest first.
 */
export function toSongRow(track: SpotifyTrack): SongRow | null {
  if (track.type !== "track" || track.is_local === true || !track.id) return null;
  const artists = (track.artists ?? [])
    .map((artist) => artist.name.trim())
    .filter((name) => name.length > 0);
  if (artists.length === 0) return null;
  return {
    source: "spotify",
    source_id: track.id,
    isrc: track.external_ids?.isrc ?? null,
    title: track.name,
    artists,
    album: track.album?.name ?? null,
    duration_ms: track.duration_ms ?? null,
    artwork_url: track.album?.images?.[0]?.url ?? null,
  };
}

/** One row per Spotify id, first occurrence wins. A playlist can hold the same
 *  track twice, and Postgres refuses an upsert that touches a row twice. */
export function uniqueSongRows(rows: readonly SongRow[]): SongRow[] {
  const seen = new Set<string>();
  const out: SongRow[] = [];
  for (const row of rows) {
    if (seen.has(row.source_id)) continue;
    seen.add(row.source_id);
    out.push(row);
  }
  return out;
}

export interface PlaylistMeta {
  source: "spotify";
  source_id: string;
  name: string;
  description: string | null;
  artwork_url: string | null;
}

export function toPlaylistMeta(playlist: PlaylistSummary): PlaylistMeta {
  return {
    source: "spotify",
    source_id: playlist.id,
    name: playlist.name,
    description: playlist.description ? playlist.description : null,
    artwork_url: playlist.images?.[0]?.url ?? null,
  };
}

export interface TasteArtist {
  id: string;
  name: string;
  genres: string[];
  imageUrl: string | null;
}

export function toTasteArtist(artist: TopArtist): TasteArtist {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
    imageUrl: artist.images?.[0]?.url ?? null,
  };
}

export interface TasteTrack {
  sourceId: string;
  title: string;
  artists: string[];
}

export function toTasteTrack(row: SongRow): TasteTrack {
  return { sourceId: row.source_id, title: row.title, artists: row.artists };
}
