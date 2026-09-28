"use client";

import { useState } from "react";
import { getPlaylistTracks, importPlaylistToRoom, listMyPlaylists } from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import { PlaylistCarousel, type Playlist } from "../playlist-carousel";
import { PlaylistView } from "./playlist-view";
import { unwrap, type AddRunner } from "./runner";

/** The signed-in user's own YouTube playlists, and one opened for picking. */
export function PlaylistsTab({ roomId, runner }: { roomId: string; runner: AddRunner }) {
  const { busy, run } = runner;
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [open, setOpen] = useState<{ playlist: Playlist; tracks: VideoMeta[] | null } | null>(null);

  function loadPlaylists() {
    run(async () => setPlaylists(unwrap(await listMyPlaylists())));
  }

  function browse(playlist: Playlist) {
    setOpen({ playlist, tracks: null });
    run(async () => {
      const tracks = unwrap(await getPlaylistTracks(playlist.id));
      // Ignore a late answer for a playlist that is no longer open.
      setOpen((current) => (current?.playlist.id === playlist.id ? { playlist, tracks } : current));
    });
  }

  if (open) {
    return (
      <PlaylistView
        roomId={roomId}
        playlist={open.playlist}
        tracks={open.tracks}
        truncated={false}
        backLabel="Playlists"
        onBack={() => setOpen(null)}
        onAddAll={async () => unwrap(await importPlaylistToRoom(roomId, open.playlist.id))}
        runner={runner}
      />
    );
  }

  return !playlists ? (
    <button className="btn" disabled={busy} onClick={loadPlaylists}>
      Load my playlists
    </button>
  ) : (
    <PlaylistCarousel playlists={playlists} busy={busy} onOpen={browse} onRefresh={loadPlaylists} />
  );
}
