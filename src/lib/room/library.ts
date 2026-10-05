"use server";

import { createImportService, type TrackToMatch } from "../../audio/imports";
import { mp3serverServiceConfig } from "../spotify/config";
import { getLibraryPlaylists, type LibraryPlaylist } from "../spotify/library";
import { matchResultUpdate, sendableTrack } from "../spotify/match-plan";
import { supabaseMatchStore } from "../spotify/match-store";
import { createClient } from "../supabase/server";
import { enqueueTrack } from "./actions";
import { enqueueMany } from "./enqueue-many";
import {
  matchView,
  playlistQueueSummary,
  toLibraryRow,
  trackFromSong,
  uniqueByVideo,
  type LibraryRow,
  type SongForRoom,
} from "./library-rows";
import type { AddTrackInput } from "./types";

/**
 * The room's Library tab. Every read goes through the caller's own client,
 * so RLS limits it to their library; a song is queued only if it is in their
 * liked songs or one of their playlists.
 */

export type LibraryResult<T> = { ok: true; data: T } | { ok: false; notice: string };

const SONG_COLUMNS =
  "id, title, artists, artwork_url, duration_ms, match_state, video_id, video_duration_ms, match_confidence";
/** Enough to scroll and filter; a library past this shows its newest likes. */
const LIKED_LIMIT = 1000;
const MATCH_TIMEOUT_MS = 20_000;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

function failed(what: string, err: unknown): { ok: false; notice: string } {
  console.error(`${what} failed:`, err);
  return { ok: false, notice: `${what} failed: ${err instanceof Error ? err.message : String(err)}` };
}

function joinedSong(row: { songs: SongForRoom | null }): SongForRoom {
  if (row.songs === null) throw new Error("library row came back without its song");
  return row.songs;
}

export async function listLikedForRoom(): Promise<LibraryResult<LibraryRow[]>> {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("library_songs")
      .select(`added_at, songs(${SONG_COLUMNS})`)
      .eq("user_id", user.id)
      .order("added_at", { ascending: false })
      .limit(LIKED_LIMIT);
    if (error) throw new Error(error.message);
    return { ok: true, data: ((data ?? []) as unknown as { songs: SongForRoom | null }[]).map((r) => toLibraryRow(joinedSong(r))) };
  } catch (err) {
    return failed("Loading your liked songs", err);
  }
}

export async function listPlaylistsForRoom(): Promise<LibraryResult<LibraryPlaylist[]>> {
  try {
    const { user } = await requireUser();
    return { ok: true, data: await getLibraryPlaylists(user.id) };
  } catch (err) {
    return failed("Loading your playlists", err);
  }
}

async function playlistSongs(playlistId: string): Promise<SongForRoom[]> {
  const { supabase } = await requireUser();
  // RLS returns rows only for the caller's own playlists.
  const { data, error } = await supabase
    .from("playlist_songs")
    .select(`position, songs(${SONG_COLUMNS})`)
    .eq("playlist_id", playlistId)
    .order("position");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { songs: SongForRoom | null }[]).map(joinedSong);
}

export async function listPlaylistSongsForRoom(playlistId: string): Promise<LibraryResult<LibraryRow[]>> {
  try {
    return { ok: true, data: (await playlistSongs(playlistId)).map(toLibraryRow) };
  } catch (err) {
    return failed("Loading that playlist", err);
  }
}

/** Match one song on mp3server now and save the answer on the song. */
async function matchNow(song: SongForRoom, track: TrackToMatch): Promise<AddTrackInput | null> {
  const result = await createImportService({ ...mp3serverServiceConfig(), timeoutMs: MATCH_TIMEOUT_MS }).matchOne(
    track,
  );
  const update = matchResultUpdate(song.id, result);
  await supabaseMatchStore().applyUpdates([update]);
  if (update.state !== "matched") return null;
  return trackFromSong({
    ...song,
    match_state: "matched",
    video_id: update.videoId,
    video_duration_ms: update.videoDurationMs,
    match_confidence: update.confidence,
  });
}

export async function queueLibrarySong(roomId: string, songId: string): Promise<LibraryResult<string>> {
  try {
    const { supabase, user } = await requireUser();
    const [liked, listed] = await Promise.all([
      supabase.from("library_songs").select("song_id").eq("user_id", user.id).eq("song_id", songId).limit(1),
      // RLS limits playlist_songs to the caller's own playlists
      supabase.from("playlist_songs").select("song_id").eq("song_id", songId).limit(1),
    ]);
    if (liked.error) throw new Error(liked.error.message);
    if (listed.error) throw new Error(listed.error.message);
    if ((liked.data ?? []).length === 0 && (listed.data ?? []).length === 0) {
      return { ok: false, notice: "That song isn't in your library." };
    }

    const { data, error } = await supabase.from("songs").select(SONG_COLUMNS).eq("id", songId).single();
    if (error) throw new Error(error.message);
    const song = data as SongForRoom;

    let track = trackFromSong(song);
    if (track === null) {
      // Pending, matching and failed songs are matched on the spot; only a
      // song with nothing to play is refused.
      if (matchView(song).state === "unavailable") {
        return { ok: false, notice: `No playable match was found for “${song.title}”.` };
      }
      const toMatch = sendableTrack({
        id: song.id,
        title: song.title,
        artists: song.artists,
        durationMs: song.duration_ms,
      });
      if (toMatch === null) {
        // mp3server would refuse it, so it is failed now rather than left
        // looking like it's still in line.
        console.error(`Song ${song.id} can't be matched: its title or artist is blank. Marking it failed.`);
        await supabaseMatchStore().applyUpdates([{ songId: song.id, state: "failed" }]);
        return { ok: false, notice: "That song can’t be matched because its title or artist is missing." };
      }
      try {
        track = await matchNow(song, toMatch);
      } catch (err) {
        // A timeout or a failed search saves nothing, so the song keeps its
        // state: a pending one goes out with the next batch, a failed one
        // goes back in line a day after it failed.
        console.error(`Matching song ${song.id} on click failed:`, err);
        return {
          ok: false,
          notice: `Couldn’t match “${song.title}” just now. It’s still in line to be matched; try again later.`,
        };
      }
      if (track === null) return { ok: false, notice: `No playable match was found for “${song.title}”.` };
    }

    await enqueueTrack(roomId, track);
    return { ok: true, data: `Added “${song.title}”` };
  } catch (err) {
    return failed("Adding that song", err);
  }
}

/** Whether a playlist is one of the caller's; RLS hides everyone else's. */
async function ownsPlaylist(playlistId: string): Promise<boolean> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("playlists").select("id").eq("id", playlistId).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function queueLibraryPlaylist(roomId: string, playlistId: string): Promise<LibraryResult<string>> {
  try {
    const songs = await playlistSongs(playlistId);
    if (songs.length === 0) {
      // RLS returns nothing for someone else's playlist and for an empty one
      // alike, so ask which it is.
      const mine = await ownsPlaylist(playlistId);
      return { ok: false, notice: mine ? "That playlist has no songs yet." : "That playlist isn't in your library." };
    }
    const tracks = uniqueByVideo(songs.map(trackFromSong).filter((t): t is AddTrackInput => t !== null));
    const added = await enqueueMany(roomId, tracks);
    const states = songs.map((s) => toLibraryRow(s).state);
    return {
      ok: true,
      data: playlistQueueSummary({
        added,
        ready: tracks.length,
        matching: states.filter((s) => s === "matching").length,
        unavailable: states.filter((s) => s === "unavailable").length,
        failed: states.filter((s) => s === "failed").length,
      }),
    };
  } catch (err) {
    return failed("Queueing that playlist", err);
  }
}
