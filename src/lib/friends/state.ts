export type FriendState = "none" | "friends" | "requested" | "incoming";

export interface FriendshipRow {
  requester: string;
  addressee: string;
  status: string;
}

/** My relationship to `otherId`, given every friendship row I'm part of. */
export function friendState(rows: FriendshipRow[], myId: string, otherId: string): FriendState {
  const row = rows.find(
    (r) =>
      (r.requester === myId && r.addressee === otherId) ||
      (r.requester === otherId && r.addressee === myId),
  );
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requester === myId ? "requested" : "incoming";
}
