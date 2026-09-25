"use server";

import { revalidatePath } from "next/cache";
import { syncNowAllowed } from "../../spotify/diff";
import { createClient } from "../supabase/server";
import { connectionSyncState, deleteConnection, deleteSpotifyData } from "./connection";
import { syncOneUser } from "./sync";

/**
 * /library's buttons. Every action acts on the caller alone: the user id comes
 * from their session, never from an argument, so these can't be pointed at
 * someone else's connection.
 */

export type ActionResult = { ok: boolean; notice: string };

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

export async function syncNowAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  const state = await connectionSyncState(userId);
  if (!state.connected) return { ok: false, notice: "Spotify isn't connected." };
  // The run only takes active connections, so a revoked one would "sync" nothing.
  if (state.status === "revoked") {
    return { ok: false, notice: "Spotify access was revoked. Reconnect to keep syncing." };
  }
  if (!syncNowAllowed(state.lastAttemptAt, new Date())) {
    return { ok: false, notice: "A sync started less than a minute ago." };
  }

  const result = await syncOneUser(userId);
  revalidatePath("/library");
  if (result.status === "busy") {
    return { ok: false, notice: "A sync is already running. Try again in a minute." };
  }
  if (result.failed > 0) return { ok: false, notice: "Sync failed. The error is shown above." };
  return { ok: true, notice: "Synced." };
}

export async function disconnectSpotifyAction(): Promise<ActionResult> {
  await deleteConnection(await requireUserId());
  revalidatePath("/library");
  return { ok: true, notice: "Disconnected. Your library stays in june." };
}

export async function deleteSpotifyDataAction(): Promise<ActionResult> {
  const result = await deleteSpotifyData(await requireUserId());
  revalidatePath("/library");
  if (result === "busy") return { ok: false, notice: "A sync is running. Try again in a minute." };
  return { ok: true, notice: "Disconnected, and your Spotify library is deleted from june." };
}
