"use server";

import { createClient } from "../supabase/server";
import { friendState, type FriendState, type FriendshipRow } from "./state";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export interface FriendCard {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  state: FriendState;
}

function cardName(p: { display_name: string | null; username: string | null }): string {
  return p.display_name?.trim() || p.username || "Guest";
}

/** Every friendship row involving me. Only my own (trusted) id touches the filter. */
async function myFriendships(supabase: Supabase, myId: string): Promise<FriendshipRow[]> {
  const { data } = await supabase
    .from("friendships")
    .select("requester, addressee, status")
    .or(`requester.eq.${myId},addressee.eq.${myId}`);
  return (data as FriendshipRow[] | null) ?? [];
}

async function profilesByIds(supabase: Supabase, ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .in("id", ids);
  return new Map(((data as ProfileRow[] | null) ?? []).map((p) => [p.id, p]));
}

function toCard(id: string, p: ProfileRow | undefined, state: FriendState): FriendCard {
  return {
    userId: id,
    username: p?.username ?? null,
    displayName: p ? cardName(p) : "Guest",
    avatarUrl: p?.avatar_url ?? null,
    state,
  };
}

/** Send a request, or auto-accept if the other person already requested me. */
export async function sendFriendRequest(targetId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  if (!targetId || targetId === user.id) throw new Error("You can't add yourself.");

  const rows = await myFriendships(supabase, user.id);
  const existing = rows.find(
    (r) =>
      (r.requester === user.id && r.addressee === targetId) ||
      (r.requester === targetId && r.addressee === user.id),
  );

  if (existing) {
    if (existing.status === "accepted") return; // already friends
    if (existing.requester === targetId) return void acceptFrom(supabase, targetId, user.id);
    return; // I already have a pending request out
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ requester: user.id, addressee: targetId, status: "pending" });
  if (error) {
    // A simultaneous reverse request won the pair index — accept it instead.
    if ((error as { code?: string }).code === "23505") {
      return void acceptFrom(supabase, targetId, user.id);
    }
    throw new Error(`Couldn't send request: ${error.message}`);
  }
}

async function acceptFrom(supabase: Supabase, requesterId: string, meId: string): Promise<void> {
  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("requester", requesterId)
    .eq("addressee", meId)
    .eq("status", "pending");
  if (error) throw new Error(`Couldn't accept request: ${error.message}`);
}

/** Accept or decline a pending request that was sent TO me. */
export async function respondToRequest(requesterId: string, accept: boolean): Promise<void> {
  const { supabase, user } = await requireUser();
  if (accept) return acceptFrom(supabase, requesterId, user.id);

  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("requester", requesterId)
    .eq("addressee", user.id)
    .eq("status", "pending");
  if (error) throw new Error(`Couldn't decline request: ${error.message}`);
}

/** Remove a friend (or cancel a request I sent), whichever direction the row is. */
export async function removeFriend(otherId: string): Promise<void> {
  const { supabase, user } = await requireUser();
  const rows = await myFriendships(supabase, user.id);
  const pair = rows.find(
    (r) =>
      (r.requester === user.id && r.addressee === otherId) ||
      (r.requester === otherId && r.addressee === user.id),
  );
  if (!pair) return;
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("requester", pair.requester)
    .eq("addressee", pair.addressee);
  if (error) throw new Error(`Couldn't remove friend: ${error.message}`);
}

/** Incoming pending requests + accepted friends, in one pass for the /friends page. */
export async function getFriendsOverview(): Promise<{
  incoming: FriendCard[];
  friends: FriendCard[];
}> {
  const { supabase, user } = await requireUser();
  const rows = await myFriendships(supabase, user.id);

  const friendIds = rows
    .filter((r) => r.status === "accepted")
    .map((r) => (r.requester === user.id ? r.addressee : r.requester));
  const incomingIds = rows
    .filter((r) => r.status === "pending" && r.addressee === user.id)
    .map((r) => r.requester);

  const profiles = await profilesByIds(supabase, [...friendIds, ...incomingIds]);
  return {
    incoming: incomingIds.map((id) => toCard(id, profiles.get(id), "incoming")),
    friends: friendIds.map((id) => toCard(id, profiles.get(id), "friends")),
  };
}

/** Find people by username handle, annotated with my current relationship to them. */
export async function searchUsers(query: string): Promise<FriendCard[]> {
  const { supabase, user } = await requireUser();
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const escaped = q.replace(/[%_\\]/g, "\\$&"); // treat wildcards as literals

  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .not("username", "is", null)
    .ilike("username", `${escaped}%`)
    .neq("id", user.id)
    .limit(10);

  const rows = await myFriendships(supabase, user.id);
  return ((data as ProfileRow[] | null) ?? []).map((p) =>
    toCard(p.id, p, friendState(rows, user.id, p.id)),
  );
}

/** My relationship to a set of users (for the room's add-friend controls). */
export async function friendStatesFor(userIds: string[]): Promise<Record<string, FriendState>> {
  const { supabase, user } = await requireUser();
  const rows = await myFriendships(supabase, user.id);
  const out: Record<string, FriendState> = {};
  for (const id of userIds) {
    if (id !== user.id) out[id] = friendState(rows, user.id, id);
  }
  return out;
}

export interface PublicProfile extends FriendCard {
  isMe: boolean;
  signedIn: boolean;
}

/** A user's public profile by handle, for /u/<username>. Viewable while signed out. */
export async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const supabase = await createClient();
  const handle = username.trim().toLowerCase();
  if (!handle) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .eq("username", handle)
    .maybeSingle();
  if (!data) return null;
  const profile = data as ProfileRow;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isMe = user?.id === profile.id;
  let state: FriendState = "none";
  if (user && !isMe) {
    state = friendState(await myFriendships(supabase, user.id), user.id, profile.id);
  }

  return { ...toCard(profile.id, profile, state), isMe, signedIn: Boolean(user) };
}
