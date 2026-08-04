import { createClient } from "../supabase/server";
import { createServiceClient } from "../supabase/service";
import {
  groupPastJams,
  playEvent,
  topArtists,
  type ArtistCount,
  type PastJam,
  type PlayRow,
  type PlayedTrack,
} from "./play-event";

/**
 * Listening history. Deliberately *not* a "use server" module: recordPlay
 * writes with the service role, and exposing that as a callable server action
 * would let anyone forge a listening history — their own or someone else's.
 * Client components reach the read side through src/lib/room/history.ts.
 */

/** Enough to fill a home-page list without paging. */
const RECENT_LIMIT = 12;

const PLAY_COLS =
  "room_id, video_id, title, artist, thumbnail_url, played_at, user_id, profiles(display_name)";

/**
 * Remember a track the room just finished — one row per person who was in the
 * room, which is also what makes "we listened to this together" durable after
 * the room is deleted.
 *
 * Best effort by design: a play that fails to record must never take down the
 * advance that triggered it. The room moving on matters more than the memory
 * of it.
 */
export async function recordPlay({
  roomId,
  track,
  endedAt,
  skipped,
}: {
  roomId: string;
  track: PlayedTrack;
  endedAt: number;
  skipped: boolean;
}): Promise<void> {
  const event = playEvent({ track, endedAt, skipped });
  if (event === null) return;

  try {
    const service = createServiceClient();
    const { data } = await service
      .from("room_participants")
      .select("user_id")
      .eq("room_id", roomId);

    const listeners = ((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id);
    if (listeners.length === 0) return;

    await service.from("plays").insert(
      listeners.map((userId) => ({
        user_id: userId,
        room_id: roomId,
        video_id: event.videoId,
        title: event.title,
        artist: event.artist,
        thumbnail_url: event.thumbnailUrl,
        genre: event.genre,
        artist_id: event.artistId,
        listened_ms: event.listenedMs,
        duration_ms: event.durationMs,
        skipped: event.skipped,
        added_by: event.addedBy,
      })),
    );
  } catch {
    // See above: never let history-keeping break playback.
  }
}

interface PlayRowShape {
  room_id: string;
  video_id: string;
  title: string;
  artist: string | null;
  thumbnail_url: string | null;
  played_at: string;
  user_id: string;
  profiles: { display_name: string | null } | null;
}

function toPlayRow(row: PlayRowShape): PlayRow {
  return {
    roomId: row.room_id,
    videoId: row.video_id,
    title: row.title,
    artist: row.artist,
    thumbnailUrl: row.thumbnail_url,
    playedAt: row.played_at,
    userId: row.user_id,
    // The live profile, so a rename shows up on old plays — the same rule the
    // participant list and chat follow.
    userName: row.profiles?.display_name?.trim() || "Guest",
  };
}

/** What you listened to lately, newest first. RLS keeps this to your own rows. */
export async function getRecentPlays(limit = RECENT_LIMIT): Promise<PlayRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("plays")
    .select(PLAY_COLS)
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(limit);

  return ((data as PlayRowShape[] | null) ?? []).map(toPlayRow);
}

/**
 * Someone's most-played artists. Readable for yourself, and for anyone you
 * shared a room with — the plays policy decides, so a stranger simply gets
 * nothing back rather than an error.
 */
export async function getTopArtists(userId: string, limit = 5): Promise<ArtistCount[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plays")
    .select(PLAY_COLS)
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(200);

  return topArtists(((data as PlayRowShape[] | null) ?? []).map(toPlayRow), limit);
}

/** Someone's recent tracks, for their profile. Same visibility rule. */
export async function getPlaysFor(userId: string, limit = 8): Promise<PlayRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plays")
    .select(PLAY_COLS)
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(limit);

  return ((data as PlayRowShape[] | null) ?? []).map(toPlayRow);
}

/**
 * The jams you were in, most recent first. Reads every play in those rooms —
 * yours and, by the shared-room policy, your co-listeners' — so each jam can
 * name who was there.
 */
export async function getPastJams(limit = 5): Promise<PastJam[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Which rooms you were in, newest first.
  const { data: mine } = await supabase
    .from("plays")
    .select("room_id, played_at")
    .eq("user_id", user.id)
    .order("played_at", { ascending: false })
    .limit(200);

  const roomIds = [
    ...new Set(((mine as { room_id: string }[] | null) ?? []).map((r) => r.room_id)),
  ].slice(0, limit);
  if (roomIds.length === 0) return [];

  const { data } = await supabase.from("plays").select(PLAY_COLS).in("room_id", roomIds);

  return groupPastJams(((data as PlayRowShape[] | null) ?? []).map(toPlayRow), user.id);
}
