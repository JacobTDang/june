import type { YouTubePlaylist } from "./schema";
import { pickThumbnail } from "./track";

/** A user-facing summary of a YouTube playlist, for a "pick a playlist" UI. */
export interface Playlist {
  id: string;
  title: string;
  itemCount: number;
  thumbnailUrl?: string;
}

/** Map a raw `playlists.list` item into a summary. */
export function toPlaylist(playlist: YouTubePlaylist): Playlist {
  return {
    id: playlist.id,
    title: playlist.snippet.title,
    itemCount: playlist.contentDetails?.itemCount ?? 0,
    thumbnailUrl: pickThumbnail(playlist.snippet.thumbnails),
  };
}
