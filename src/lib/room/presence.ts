import type { RoomParticipant } from "./types";

/**
 * Members to display as "in the room". `room_participants` is membership
 * (permissions, one-room-per-user, room lifecycle); the presence channel says
 * who is actually connected and listening right now. `online` is the set of
 * user ids currently tracked on the room's realtime channel, or null while
 * presence is unavailable (before the first sync, or realtime down) — then the
 * full membership is shown rather than an empty room. The viewer is always
 * shown: their own track() may not have echoed back yet.
 */
export function visibleParticipants(
  participants: RoomParticipant[],
  online: ReadonlySet<string> | null,
  meId: string,
): RoomParticipant[] {
  if (online === null) return participants;
  return participants.filter((p) => p.userId === meId || online.has(p.userId));
}
