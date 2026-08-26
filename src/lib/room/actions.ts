"use server";

import { createClient } from "../supabase/server";
import { resolveDisplayName } from "../profile/display-name";
import { safeThumbnailUrl } from "./thumbnail";
import { clampText } from "./track-text";
import { advanceGuard } from "./advance-guard";
import type { PlayedTrack } from "./play-event";
import { recordPlay } from "./plays";
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

/** Every column of the now-playing projection, as a list rather than a string
 *  so the type system can check it. `now_playing_added_by` was written but
 *  never selected, which silently left `added_by` null on every recorded play
 *  — the completeness check below makes that shape of mistake a build error. */
const NOW_PLAYING_FIELDS = [
  "id",
  "now_playing_video_id",
  "now_playing_title",
  "now_playing_artist",
  "now_playing_duration_ms",
  "now_playing_thumbnail_url",
  "now_playing_started_at",
  "now_playing_added_by_name",
  "now_playing_added_by",
  "now_playing_instance",
] as const satisfies readonly (keyof RoomRow)[];

// Fails to compile if a column is added to RoomRow and not selected here.
type UnselectedRoomColumn = Exclude<keyof RoomRow, (typeof NOW_PLAYING_FIELDS)[number]>;
const _everyColumnSelected: UnselectedRoomColumn extends never ? true : never = true;
void _everyColumnSelected;

const NOW_PLAYING_COLS = NOW_PLAYING_FIELDS.join(", ");

const npFields = (
  t: AddTrackInput,
  startedAt: number | null,
  addedByName?: string | null,
  addedBy?: string | null,
) => ({
  now_playing_video_id: t.videoId,
  now_playing_title: t.title,
  now_playing_artist: t.artist ?? null,
  now_playing_duration_ms: t.durationMs,
  now_playing_thumbnail_url: t.thumbnailUrl ?? null,
  now_playing_started_at: startedAt,
  now_playing_added_by_name: addedByName ?? null,
  now_playing_added_by: addedBy ?? null,
  // A fresh id per promotion: this is what advancing compare-and-sets on, so
  // two pending copies of the same video are no longer identical.
  now_playing_instance: crypto.randomUUID(),
});

const NP_CLEARED = {
  now_playing_video_id: null,
  now_playing_title: null,
  now_playing_artist: null,
  now_playing_duration_ms: null,
  now_playing_thumbnail_url: null,
  now_playing_started_at: null,
  now_playing_added_by_name: null,
  now_playing_added_by: null,
  now_playing_instance: null,
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
  // Not "am I a member" — membership survives a closed tab until the room is
  // swept, which had this card offering to return you to a jam that ended days
  // ago. The RPC asks whether the room still has anyone in it or is still
  // playing, so returning to a jam your friends are still in keeps working.
  const { data } = await supabase.rpc("my_active_room");
  return (data as string | null) ?? null;
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

  // started_at starts NULL (pending): the shared clock begins only once a
  // listener's loader confirms the track is downloadable, via markTrackReady.
  const { data: started } = await supabase
    .from("rooms")
    .update(npFields(track, null, addedByName, user.id))
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

/**
 * Say "still here". Presence used to be membership alone, so a closed tab left
 * someone showing as in a jam until the room was swept — up to twelve hours.
 * Called on a timer by the room page; the friends list only counts people seen
 * in the last few minutes.
 */
export async function touchParticipant(roomId: string): Promise<void> {
  const { supabase } = await requireUser();
  // Best effort: a missed heartbeat costs a friend's dot, and there will be
  // another along in half a minute.
  await supabase.rpc("touch_participant", { p_room: roomId });
}

/**
 * Start the shared clock for a pending track once a listener confirms it's
 * downloadable. Compare-and-set on (roomId, videoId, started_at IS NULL) so
 * N racing clients calling this for the same track start it exactly once.
 */
export async function markTrackReady(roomId: string, videoId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("rooms")
    .update({ now_playing_started_at: Date.now() })
    .eq("id", roomId)
    .eq("now_playing_video_id", videoId)
    .is("now_playing_started_at", null);
  if (error) throw new Error(`markTrackReady failed: ${error.message}`);
}

async function popOldest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roomId: string,
): Promise<QueueItemRow | null> {
  const { data } = await supabase
    .from("queue_items")
    .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name, added_by")
    .eq("room_id", roomId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as QueueItemRow | null) ?? null;
}

// The promoted track always starts pending (started_at null) - same reasoning
// as enqueueTrack's start-if-idle path: the clock begins only once a listener
// confirms it's downloadable.
function nextFields(next: QueueItemRow) {
  return npFields(
    {
      videoId: next.video_id,
      title: next.title,
      artist: next.artist ?? undefined,
      durationMs: next.duration_ms,
      thumbnailUrl: next.thumbnail_url ?? undefined,
    },
    null,
    next.added_by_name ?? null,
    next.added_by ?? null,
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
    .select(NOW_PLAYING_COLS)
    .eq("id", roomId)
    .maybeSingle();
  const room = roomData as unknown as RoomRow | null;
  if (!room || room.now_playing_video_id !== endedVideoId) return; // already advanced

  const next = await popOldest(supabase, roomId);

  // Promote the next track pending (like the enqueue start-if-idle path) -
  // its clock starts once a listener confirms it's downloadable.
  const update = next ? nextFields(next) : NP_CLEARED;
  let query = supabase
    .from("rooms")
    .update(update)
    .eq("id", roomId)
    .eq("now_playing_video_id", endedVideoId);
  // Compare-and-set on the exact copy of the track this caller saw, so
  // concurrent "ended" events can't advance twice — including the case that
  // used to slip through, two pending copies of the same video.
  const guard = advanceGuard(room);
  query =
    guard.kind === "instance"
      ? query.eq("now_playing_instance", guard.instance)
      : guard.startedAt === null
        ? query.is("now_playing_started_at", null)
        : query.eq("now_playing_started_at", guard.startedAt);
  const { data: applied } = await query.select("id");

  const advanced = applied !== null && applied.length > 0;
  if (next && advanced) {
    await supabase.from("queue_items").delete().eq("id", next.id);
  }

  // Remember it only if this call is the one that actually moved the room on:
  // the instance guard above means concurrent "ended" events for the same
  // track all land here, and only one of them advanced anything.
  if (advanced) {
    await recordPlay({
      roomId,
      track: outgoingTrack(room),
      endedAt: Date.now(),
      skipped: false,
    });
  }
}

/** The track being replaced, as the play recorder wants it. */
function outgoingTrack(room: RoomRow): PlayedTrack {
  return {
    videoId: room.now_playing_video_id ?? "",
    title: room.now_playing_title ?? "",
    artist: room.now_playing_artist,
    thumbnailUrl: room.now_playing_thumbnail_url,
    durationMs: room.now_playing_duration_ms ?? 0,
    startedAt: room.now_playing_started_at,
    addedBy: room.now_playing_added_by,
  };
}

/**
 * Skip the current track immediately (any member). The next track is
 * promoted pending, same as advanceTrack - its clock starts once a listener
 * confirms it's downloadable, so a skip can't drop listeners mid-song either.
 */
export async function skipTrack(roomId: string): Promise<void> {
  const { supabase } = await requireUser();

  const { data: roomData } = await supabase
    .from("rooms")
    .select(NOW_PLAYING_COLS)
    .eq("id", roomId)
    .maybeSingle();
  const room = roomData as unknown as RoomRow | null;

  if (!room?.now_playing_video_id) return;

  const next = await popOldest(supabase, roomId);
  const update = next ? nextFields(next) : NP_CLEARED;

  // Same compare-and-set as advancing, for the same reason: two people hitting
  // Skip at the same moment used to skip two tracks, because the second update
  // applied unconditionally to whatever was playing by then.
  let query = supabase
    .from("rooms")
    .update(update)
    .eq("id", roomId)
    .eq("now_playing_video_id", room.now_playing_video_id);
  const guard = advanceGuard(room);
  query =
    guard.kind === "instance"
      ? query.eq("now_playing_instance", guard.instance)
      : guard.startedAt === null
        ? query.is("now_playing_started_at", null)
        : query.eq("now_playing_started_at", guard.startedAt);

  const { data: applied } = await query.select("id");
  if (applied === null || applied.length === 0) return; // someone else skipped it

  if (next) await supabase.from("queue_items").delete().eq("id", next.id);

  await recordPlay({
    roomId,
    track: outgoingTrack(room),
    endedAt: Date.now(),
    skipped: true,
  });
}

/** Remove a not-yet-played track from the queue. Throws on failure: the row
 *  leaves the queue on screen the moment it's asked for, so a refused delete
 *  has to come back here or the two lists quietly diverge. */
export async function removeQueueItem(itemId: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("queue_items").delete().eq("id", itemId);
  if (error) throw new Error(`removeQueueItem failed: ${error.message}`);
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
      .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name, added_by")
      .eq("room_id", roomId)
      .order("position", { ascending: true }),
    supabase.from("room_participants").select("user_id, name").eq("room_id", roomId),
  ]);

  return {
    id: roomId,
    nowPlaying: rowToNowPlaying(roomData as unknown as RoomRow),
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
      .select("id, video_id, title, artist, duration_ms, thumbnail_url, added_by_name, added_by")
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
      nowPlaying: rowToNowPlaying(roomData as unknown as RoomRow),
      queue: ((queueData as QueueItemRow[] | null) ?? []).map(rowToQueueTrack),
      participants,
    },
    me: { userId: user.id, name },
  };
}
