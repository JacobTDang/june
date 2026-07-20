"use server";

import { cookies } from "next/headers";
import { createYouTubeClient } from "@/src/youtube";
import { parseVideoId } from "@/src/youtube/url";
import { searchMusic, type MusicCandidate } from "@/src/discovery";
import { createClient } from "../supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "../supabase/tokens";
import { getVideoMetas } from "../video-cache";
import { supabaseVideoCache } from "../video-cache-supabase";
import { enqueueTrack } from "./actions";

async function youtubeClient(needsAuth = false) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured.");
  const accessToken = (await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value;
  if (needsAuth && !accessToken) {
    throw new Error("Connect your YouTube account first.");
  }
  return createYouTubeClient({ apiKey, accessToken });
}

/** iTunes type-ahead search — zero YouTube quota. */
export async function searchMusicAction(query: string): Promise<MusicCandidate[]> {
  if (!query.trim()) return [];
  return searchMusic(query, { limit: 8 });
}

/** Add a track by pasting a YouTube link or id (1 unit, cached). */
export async function addByLink(roomId: string, url: string): Promise<void> {
  const videoId = parseVideoId(url);
  if (!videoId) throw new Error("That doesn't look like a YouTube link.");

  const supabase = await createClient();
  const youtube = await youtubeClient();
  const [meta] = await getVideoMetas([videoId], supabaseVideoCache(supabase, youtube));
  if (!meta) throw new Error("Couldn't find that video.");
  if (!meta.embeddable) throw new Error("That video can't be played here (embedding disabled).");

  await enqueueTrack(roomId, meta);
}

/**
 * Add a track picked from iTunes search: resolve it to a YouTube videoId (one
 * search.list, cached forever in track_resolution), then enqueue.
 */
export async function addCandidate(roomId: string, candidate: MusicCandidate): Promise<void> {
  const supabase = await createClient();
  const youtube = await youtubeClient();
  const key = `${candidate.source}:${candidate.sourceId}`;

  const { data: cached } = await supabase
    .from("track_resolution")
    .select("video_id")
    .eq("key", key)
    .maybeSingle();
  let videoId = (cached as { video_id: string } | null)?.video_id ?? null;

  if (!videoId) {
    const ids = await youtube.searchVideoIds(`${candidate.artist} ${candidate.title}`, {
      maxResults: 1,
    });
    videoId = ids[0] ?? null;
    if (!videoId) throw new Error("Couldn't find a YouTube match for that track.");
    await supabase.from("track_resolution").upsert({ key, video_id: videoId });
  }

  const [meta] = await getVideoMetas([videoId], supabaseVideoCache(supabase, youtube));
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

/** The signed-in user's playlists, for the import picker. */
export async function listMyPlaylists(): Promise<
  { id: string; title: string; itemCount: number }[]
> {
  const youtube = await youtubeClient(true);
  const playlists = await youtube.listPlaylists();
  return playlists.map((p) => ({ id: p.id, title: p.title, itemCount: p.itemCount }));
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
  const metas = (await getVideoMetas(ids, supabaseVideoCache(supabase, youtube))).filter(
    (m) => m.embeddable && m.durationMs > 0,
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
