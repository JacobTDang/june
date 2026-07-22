"use server";

import { createYouTubeClient } from "@/src/youtube";
import { parseVideoId } from "@/src/youtube/url";
import {
  searchMusic,
  searchArtists,
  getArtistTopSongs,
  pickArtistMatch,
  type MusicCandidate,
  type ArtistCandidate,
} from "@/src/discovery";
import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import { meteredFetch } from "../metrics/youtube-usage";
import { getYouTubeAccessToken } from "../supabase/youtube-auth";
import { getVideoMetas, type VideoMeta } from "../video-cache";
import { supabaseVideoCache } from "../video-cache-supabase";
import { enqueueTrack } from "./actions";

async function youtubeClient(needsAuth = false) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured.");

  let accessToken: string | undefined;
  try {
    accessToken = (await getYouTubeAccessToken()) ?? undefined;
  } catch (err) {
    // A token we can't mint (server not configured, or a stale refresh token)
    // is only fatal when the action needs one. Search / add-by-link resolve via
    // the API key alone, so let those proceed without a token.
    if (needsAuth) throw err;
  }

  if (needsAuth && !accessToken) {
    throw new Error("Connect your YouTube account first.");
  }
  return createYouTubeClient({ apiKey, accessToken, fetch: meteredFetch() });
}

/** A song list plus, when the query strongly names an artist, that artist to open. */
export type SearchResult = { songs: MusicCandidate[]; artist: ArtistCandidate | null };

/**
 * iTunes type-ahead search — zero YouTube quota. Searches songs and artists
 * concurrently; surfaces an artist chip only when the query strongly names one.
 */
export async function searchMusicAction(query: string): Promise<SearchResult> {
  if (!query.trim()) return { songs: [], artist: null };
  const [songs, artists] = await Promise.all([searchMusic(query), searchArtists(query)]);
  return { songs, artist: pickArtistMatch(query, artists) };
}

/** An artist's top songs, for the artist view. Zero YouTube quota. */
export async function getArtistTopSongsAction(artistId: string): Promise<MusicCandidate[]> {
  if (!artistId) return [];
  return getArtistTopSongs(artistId);
}

/** Add a track by pasting a YouTube link or id (1 unit, cached). */
export async function addByLink(roomId: string, url: string): Promise<void> {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("That doesn't look like a YouTube link.");

  const youtube = await youtubeClient();
  const [meta] = await getVideoMetas([videoId], supabaseVideoCache(youtube));
  if (!meta) throw new Error("Couldn't find that video.");
  if (!meta.embeddable) throw new Error("That video can't be played here (embedding disabled).");

  await enqueueTrack(roomId, meta);
}

/**
 * Add a track picked from iTunes search: resolve it to a YouTube videoId (one
 * search.list, cached forever in track_resolution), then enqueue.
 */
export async function addCandidate(roomId: string, candidate: MusicCandidate): Promise<void> {
  const youtube = await youtubeClient();
  const cache = supabaseVideoCache(youtube);
  // track_resolution is a shared server cache, read/written with the service role.
  const service = createServiceClient();
  const key = `${candidate.source}:${candidate.sourceId}`;

  const { data: cached } = await service
    .from("track_resolution")
    .select("video_id")
    .eq("key", key)
    .maybeSingle();
  const cachedId = (cached as { video_id: string } | null)?.video_id ?? null;

  let meta: VideoMeta | undefined;
  if (cachedId) {
    [meta] = await getVideoMetas([cachedId], cache);
  } else {
    // The top result is often the official (non-embeddable) video — pick the
    // first result we can actually play, then cache that resolution.
    const ids = await youtube.searchVideoIds(`${candidate.artist} ${candidate.title}`, {
      maxResults: 5,
    });
    const metas = await getVideoMetas(ids, cache);
    meta = metas.find((m) => m.embeddable && m.durationMs > 0);
    if (!meta) throw new Error("Couldn't find a playable YouTube match for that track.");
    await service.from("track_resolution").upsert({ key, video_id: meta.videoId });
  }

  if (!meta || !meta.embeddable) throw new Error("That track can't be played here.");

  // Prefer the clean iTunes title/artist/artwork over the YouTube channel name.
  await enqueueTrack(roomId, {
    videoId: meta.videoId,
    title: candidate.title,
    artist: candidate.artist,
    durationMs: meta.durationMs,
    thumbnailUrl: candidate.artworkUrl ?? meta.thumbnailUrl,
  });
}

/** A playlist's songs, ready to pick from (embeddability included). */
export async function getPlaylistTracks(playlistId: string): Promise<VideoMeta[]> {
  const youtube = await youtubeClient(true);
  const ids = await youtube.listPlaylistVideoIds(playlistId);
  return getVideoMetas(ids, supabaseVideoCache(youtube));
}

/** Add a single video (by id) to the room, from the playlist-browse view. */
export async function addVideoById(roomId: string, videoId: string): Promise<void> {
  const youtube = await youtubeClient();
  const [meta] = await getVideoMetas([videoId], supabaseVideoCache(youtube));
  if (!meta) throw new Error("Couldn't find that video.");
  if (!meta.embeddable) throw new Error("That video can't be played here (embedding disabled).");
  await enqueueTrack(roomId, meta);
}

/** The signed-in user's playlists, for the import picker. */
export async function listMyPlaylists(): Promise<
  { id: string; title: string; itemCount: number; thumbnailUrl: string | null }[]
> {
  const youtube = await youtubeClient(true);
  const playlists = await youtube.listPlaylists();
  return playlists.map((p) => ({
    id: p.id,
    title: p.title,
    itemCount: p.itemCount,
    thumbnailUrl: p.thumbnailUrl ?? null,
  }));
}

/** Import a whole playlist into the room's queue. Returns how many were added. */
export async function importPlaylistToRoom(
  roomId: string,
  playlistId: string,
): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const youtube = await youtubeClient(true);
  const ids = await youtube.listPlaylistVideoIds(playlistId);

  // Skip anything already in the room (queue or now playing) so re-imports
  // don't create duplicates.
  const [{ data: existingQueue }, { data: room }] = await Promise.all([
    supabase.from("queue_items").select("video_id").eq("room_id", roomId),
    supabase.from("rooms").select("now_playing_video_id").eq("id", roomId).maybeSingle(),
  ]);
  const present = new Set<string>(
    ((existingQueue as { video_id: string }[] | null) ?? []).map((r) => r.video_id),
  );
  const nowVideo = (room as { now_playing_video_id: string | null } | null)?.now_playing_video_id;
  if (nowVideo) present.add(nowVideo);

  const metas = (await getVideoMetas(ids, supabaseVideoCache(youtube))).filter(
    (m) => m.embeddable && m.durationMs > 0 && !present.has(m.videoId),
  );
  if (metas.length === 0) return 0;

  const { data: participant } = await supabase
    .from("room_participants")
    .select("name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  const addedByName = (participant as { name: string | null } | null)?.name ?? null;

  // First track uses the start-if-idle path; the rest bulk-insert in order.
  const [first, ...rest] = metas;
  if (first) await enqueueTrack(roomId, first);

  if (rest.length > 0) {
    const base = Date.now() + 10;
    const rows = rest.map((m, i) => ({
      room_id: roomId,
      video_id: m.videoId,
      title: m.title,
      artist: m.artist ?? null,
      duration_ms: m.durationMs,
      thumbnail_url: m.thumbnailUrl ?? null,
      added_by: user.id,
      added_by_name: addedByName,
      created_at: new Date(base + i).toISOString(),
    }));
    const { error } = await supabase.from("queue_items").insert(rows);
    if (error) throw new Error(`Playlist import failed: ${error.message}`);
  }

  return metas.length;
}
