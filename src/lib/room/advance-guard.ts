/** Which compare-and-set identifies "the track I am trying to advance past".
 *
 *  Advancing is a CAS: update the room only if it still holds the track the
 *  caller saw. Matching on (videoId, started_at) works while a track is
 *  playing, because started_at is effectively unique — but a *pending* track
 *  has started_at NULL, and two pending copies of the same video are identical
 *  in every column. On a queue of [V, V, W], two clients timing out on the
 *  first V could each match, and the second one would advance past the second V
 *  as well. Hence a per-promotion instance id. */

export type AdvanceGuard =
  | { kind: "instance"; instance: string }
  | { kind: "legacy"; startedAt: number | null };

export function advanceGuard(room: {
  now_playing_instance: string | null;
  now_playing_started_at: number | null;
}): AdvanceGuard {
  if (room.now_playing_instance !== null) {
    return { kind: "instance", instance: room.now_playing_instance };
  }
  // A room that was already mid-track when instances shipped has none. Fall
  // back to the old guard rather than leaving it unable to advance at all.
  return { kind: "legacy", startedAt: room.now_playing_started_at };
}
