"use server";

import { createClient } from "../supabase/server";
import { resolveDisplayName } from "../profile/display-name";
import { safeThumbnailUrl } from "./thumbnail";
import { clampText } from "./track-text";
import {
  rowToNowPlaying,
  rowToQueueTrack,
  type AddTrackInput,
  type ParticipantRow,
  type QueueItemRow,
  type RoomParticipant,
  type RoomRow,
  type RoomState,
} from "./types";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

const NOW_PLAYING_COLS =
  "id, now_playing_video_id, now_playing_title, now_playing_artist, now_playing_duration_ms, now_playing_thumbnail_url, now_playing_started_at, now_playing_added_by_name";

const npFields = (t: AddTrackInput, startedAt: number, addedByName?: string | null) => ({
  now_playing_video_id: t.videoId,
  now_playing_title: t.title,
  now_playing_artist: t.artist ?? null,
  now_playing_duration_ms: t.durationMs,
  now_playing_thumbnail_url: t.thumbnailUrl ?? null,
  now_playing_started_at: startedAt,
  now_playing_added_by_name: addedByName ?? null,
});

const NP_CLEARED = {
  now_playing_video_id: null,
  now_playing_title: null,
  now_playing_artist: null,
  now_playing_duration_ms: null,
  now_playing_thumbnail_url: null,
  now_playing_started_at: null,
  now_playing_added_by_name: null,
};

/** Create a room, add the creator as a participant, and return the room code. */
export async function createRoom(displayName: string): Promise<string> {
  const { supabase } = await requireUser();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    // Insert the room and the host participant atomically, so a room never
    // briefly exists with zero participants (which cleanup would treat as
    // empty). Raises 23505 on a code collision - retry with a fresh code.
    const { error } = await supabase.rpc("create_room", { p_code: code, p_name: displayName });
    if (!error) return code;
    if (error.code !== "23505") throw new Error(`createRoom failed: ${error.message}`);
  }
  throw new Error("createRoom: could not allocate a unique room code");
}

/**
 * Leave a room. Removes our participant row and, if we were the last one,
 * deletes the room outright (queue + participants cascade) so it doesn't linger
 * as a dead room. Done in one SECURITY DEFINER call because the empty-room
 * delete would otherwise be RLS-blocked once we're no longer a participant.
 */
export async function leaveRoom(roomId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("leave_room", { p_room: roomId });
  if (error) throw new Error(`leaveRoom failed: ${error.message}`);
}

/** The room the signed-in user is currently in (one per user), or null. */
export async function getMyRoom(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("room_participants")
    .select("room_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as { room_id: string } | null)?.room_id ?? null;
}

/**
 * Add a track. If the room is idle it starts immediately (race-safe via a
 * conditional update); otherwise it joins the FIFO queue.
 */
export async function enqueueTrack(roomId: string, rawTrack: AddTrackInput): Promise<void> {
  const { supabase, user } = await requireUser();

  // Some add paths carry client-supplied metadata; the thumbnail is rendered as
  // an <img src> for everyone in the room. Drop any thumbnail that isn't from a
  // provider we use so a room member can't beacon other participants' IPs.
  const track: AddTrackInput = {
    ...rawTrack,
    title: clampText(rawTrack.title),
    artist: rawTrack.artist ? clampText(rawTrack.artist) : rawTrack.artist,
    thumbnailUrl: safeThumbnailUrl(rawTrack.thumbnailUrl) ?? undefined,
  };

  const { data: participant } = await supabase
    .from("room_participants")
    .select("name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  const addedByName = (participant as { name: string | null } | null)?.name ?? null;

  const { data: started } = await supabase
    .from("rooms")
    .update(npFields(track, Date.now(), addedByName))
    .eq("id", roomId)
    .is("now_playing_video_id", null)
    .select("id");

  if (started && started.length > 0) return; // we started it

  const { error } = await supabase.from("queue_items").insert({
    room_id: roomId,
    video_id: track.videoId,
    title: track.title,
    artist: track.artist ?? null,
    duration_ms: track.durationMs,
    thumbnail_url: track.thumbnailUrl ?? null,
    added_by: user.id,
    added_by_name: addedByName,
  });
  if (error) throw new Error(`enqueueTrack failed: ${error.message}`);
}

async function popOldest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
): Promise<QueueItemRow | null> {
  const { data } = await supabase
    .from("queue_items")
    .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name")
    .eq("room_id", roomId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as QueueItemRow | null) ?? null;
}

function nextFields(next: QueueItemRow, startedAt: number) {
  return npFields(
    {
      videoId: next.video_id,
      title: next.title,
      artist: next.artist ?? undefined,
      durationMs: next.duration_ms,
      thumbnailUrl: next.thumbnail_url ?? undefined,
    },
    startedAt,
    next.added_by_name ?? null,
  );
}

/**
 * Auto-advance when a track ends. Idempotent: only advances if the current
 * track still matches `endedVideoId`, so multiple clients firing "ended" at
 * once can't double-skip. The next track is timed back-to-back (no drift).
 */
export async function advanceTrack(roomId: string, endedVideoId: string): Promise<void> {
  const { supabase } = await requireUser();

  const { data: roomData } = await supabase
    .from("rooms")
    .select("now_playing_video_id, now_playing_started_at, now_playing_duration_ms")
    .eq("id", roomId)
    .maybeSingle();
  const room = roomData as Pick<
    RoomRow,
    "now_playing_video_id" | "now_playing_started_at" | "now_playing_duration_ms"
  > | null;
  if (!room || room.now_playing_video_id !== endedVideoId) return; // already advanced

  const next = await popOldest(supabase, roomId);

  // Start the next track now (like skipTrack). Deriving it from the ended
  // track's metadata duration schedules it in the future whenever the real
  // video is shorter than its metadata, which stalls/loops playback.
  const update = next ? nextFields(next, Date.now()) : NP_CLEARED;
  const { data: applied } = await supabase
    .from("rooms")
    .update(update)
    .eq("id", roomId)
    .eq("now_playing_video_id", endedVideoId)
    // Guard on the exact track instance we read, not just its video id - with
    // duplicate videos the id is unchanged after advancing, so concurrent
    // "ended" events would otherwise double-advance.
    .eq("now_playing_started_at", room.now_playing_started_at)
    .select("id");

  if (next && applied && applied.length > 0) {
    await supabase.from("queue_items").delete().eq("id", next.id);
  }
}

/** Skip the current track immediately (any member). Next starts now. */
export async function skipTrack(roomId: string): Promise<void> {
  const { supabase } = await requireUser();
  const next = await popOldest(supabase, roomId);
  const update = next ? nextFields(next, Date.now()) : NP_CLEARED;
  await supabase.from("rooms").update(update).eq("id", roomId);
  if (next) await supabase.from("queue_items").delete().eq("id", next.id);
}

/** Remove a not-yet-played track from the queue. */
export async function removeQueueItem(itemId: string): Promise<void> {
  const { supabase } = await requireUser();
  await supabase.from("queue_items").delete().eq("id", itemId);
}

/** Reorder the queue to an explicit order (any participant). Rewrites positions
 *  via a participant-checked function - clients can't reorder rows directly.
 *  `orderedIds` is the full queue in its new order (drag-to-reorder). */
export async function reorderQueue(roomId: string, orderedIds: string[]): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("reorder_queue", {
    p_room: roomId,
    p_item_ids: orderedIds,
  });
  if (error) throw new Error(`reorderQueue failed: ${error.message}`);
}

/** Full current room state, for the initial page load. */
export async function getRoomState(roomId: string): Promise<RoomState | null> {
  const { supabase } = await requireUser();

  const { data: roomData } = await supabase
    .from("rooms")
    .select(NOW_PLAYING_COLS)
    .eq("id", roomId)
    .maybeSingle();
  if (!roomData) return null;

  const [{ data: queueData }, { data: participantData }] = await Promise.all([
    supabase
      .from("queue_items")
      .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name")
      .eq("room_id", roomId)
      .order("position", { ascending: true }),
    supabase.from("room_participants").select("user_id, name").eq("room_id", roomId),
  ]);

  return {
    id: roomId,
    nowPlaying: rowToNowPlaying(roomData as RoomRow),
    queue: ((queueData as QueueItemRow[] | null) ?? []).map(rowToQueueTrack),
    participants: await enrichParticipants(
      supabase,
      (participantData as ParticipantRow[] | null) ?? [],
    ),
  };
}

/** Merge participant rows with their profiles for a fresh display name + avatar. */
async function enrichParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: ParticipantRow[],
): Promise<RoomParticipant[]> {
  if (rows.length === 0) return [];
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in(
      "id",
      rows.map((r) => r.user_id),
    );
  const byId = new Map(
    (
      (data as { id: string; display_name: string | null; avatar_url: string | null }[] | null) ??
      []
    ).map((p) => [p.id, p] as const),
  );
  return rows.map((r) => {
    const profile = byId.get(r.user_id);
    return {
      userId: r.user_id,
      name: profile?.display_name?.trim() || r.name || "Guest",
      avatarUrl: profile?.avatar_url ?? null,
    };
  });
}

export type EnterRoomResult =
  | { status: "ok"; state: RoomState; me: { userId: string; name: string } }
  | { status: "unauthenticated" }
  | { status: "not_found" };

/**
 * Join a room and load its state in a single pass. Replaces the old
 * getUser → getRoomState → joinRoom → getRoomState sequence (~a dozen serial
 * round-trips) with one user fetch, one room lookup, and a parallel
 * join + queue + participants fetch.
 */
export async function enterRoom(code: string): Promise<EnterRoomResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };

  const [{ data: myProfile }, { data: roomData }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
    supabase.from("rooms").select(NOW_PLAYING_COLS).eq("id", code).maybeSingle(),
  ]);
  if (!roomData) return { status: "not_found" };

  const mine = myProfile as { display_name: string | null; avatar_url: string | null } | null;
  const name = resolveDisplayName(mine?.display_name, user);
  const myAvatar = mine?.avatar_url ?? null;

  const [, { data: queueData }, { data: participantData }] = await Promise.all([
    // One room per user: entering a room moves you here from any previous one.
    supabase
      .from("room_participants")
      .upsert({ room_id: code, user_id: user.id, name }, { onConflict: "user_id" }),
    supabase
      .from("queue_items")
      .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name")
      .eq("room_id", code)
      .order("position", { ascending: true }),
    supabase.from("room_participants").select("user_id, name").eq("room_id", code),
  ]);

  const participants = await enrichParticipants(
    supabase,
    (participantData as ParticipantRow[] | null) ?? [],
  );
  // The join upsert runs in parallel with the participants read, so ensure the
  // current user shows up immediately regardless of which landed first.
  if (!participants.some((p) => p.userId === user.id)) {
    participants.push({ userId: user.id, name, avatarUrl: myAvatar });
  }

  return {
    status: "ok",
    state: {
      id: code,
      nowPlaying: rowToNowPlaying(roomData as RoomRow),
      queue: ((queueData as QueueItemRow[] | null) ?? []).map(rowToQueueTrack),
      participants,
    },
    me: { userId: user.id, name },
  };
}
