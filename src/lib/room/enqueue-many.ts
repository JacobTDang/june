import "server-only";
import { createClient } from "../supabase/server";
import { enqueueTrack } from "./actions";
import { uniqueByVideo } from "./library-rows";
import { safeThumbnailUrl } from "./thumbnail";
import { clampText } from "./track-text";
import type { AddTrackInput } from "./types";

/**
 * Queue tracks in order, skipping a video listed twice and any already in
 * the room (queued or playing), so adding the same playlist twice doesn't
 * double it. The first goes through enqueueTrack, which starts an idle room;
 * the rest are one insert, stamped a millisecond apart so they keep their
 * order. Returns how many were queued.
 *
 * Not a server action: it trusts its caller's tracks, so it is only ever
 * called from server code that built them.
 */
export async function enqueueMany(roomId: string, tracks: readonly AddTrackInput[]): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const [queueRead, roomRead] = await Promise.all([
    supabase.from("queue_items").select("video_id").eq("room_id", roomId),
    supabase.from("rooms").select("now_playing_video_id").eq("id", roomId).maybeSingle(),
  ]);
  if (queueRead.error) throw new Error(`Reading the queue failed: ${queueRead.error.message}`);
  if (roomRead.error) throw new Error(`Reading the room failed: ${roomRead.error.message}`);
  const present = new Set(((queueRead.data ?? []) as { video_id: string }[]).map((r) => r.video_id));
  const playing = (roomRead.data as { now_playing_video_id: string | null } | null)?.now_playing_video_id;
  if (playing) present.add(playing);

  const fresh = uniqueByVideo(tracks).filter((t) => !present.has(t.videoId));
  const [first, ...rest] = fresh;
  if (!first) return 0;
  await enqueueTrack(roomId, first);
  if (rest.length === 0) return 1;

  const { data: participant } = await supabase
    .from("room_participants")
    .select("name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  const addedByName = (participant as { name: string | null } | null)?.name ?? null;

  const base = Date.now() + 10;
  const { error } = await supabase.from("queue_items").insert(
    rest.map((t, i) => ({
      room_id: roomId,
      video_id: t.videoId,
      title: clampText(t.title),
      artist: t.artist ? clampText(t.artist) : null,
      duration_ms: t.durationMs,
      thumbnail_url: safeThumbnailUrl(t.thumbnailUrl),
      added_by: user.id,
      added_by_name: addedByName,
      created_at: new Date(base + i).toISOString(),
    })),
  );
  if (error) throw new Error(`Queueing the tracks failed: ${error.message}`);
  return fresh.length;
}
