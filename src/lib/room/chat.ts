"use server";

import { createClient } from "../supabase/server";
import { normalizeMessageBody, type ChatMessage } from "./chat-message";

/** How much scrollback a client loads. The log is ephemeral — it dies with
 *  the room — so there is no history worth paging through. */
const HISTORY_LIMIT = 100;

interface MessageRow {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

/** The room's recent messages, oldest first. RLS decides whether the caller
 *  may see them at all — a non-participant gets an empty log, not an error. */
export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("room_messages")
    .select("id, user_id, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(`Could not load the chat: ${error.message}`);

  const rows = ((data as MessageRow[] | null) ?? []).reverse();
  return withAuthorNames(supabase, rows);
}

/** Post a message as the signed-in user. Throws on an unsendable body so the
 *  caller can say why rather than dropping it. */
export async function sendMessage(roomId: string, input: string): Promise<void> {
  const { supabase, user } = await requireUser();

  const body = normalizeMessageBody(input);
  if (body === null) throw new Error("That message is empty or too long.");

  const { error } = await supabase
    .from("room_messages")
    .insert({ room_id: roomId, user_id: user.id, body });
  if (error) throw new Error(`Could not send that message: ${error.message}`);
}

/** Attach display names, resolved the same way the participant list resolves
 *  them: the live profile first, so a rename shows up on old messages too. */
async function withAuthorNames(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: MessageRow[],
): Promise<ChatMessage[]> {
  if (rows.length === 0) return [];

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", [...new Set(rows.map((r) => r.user_id))]);
  const names = new Map(
    ((data as { id: string; display_name: string | null }[] | null) ?? []).map(
      (p) => [p.id, p.display_name?.trim() || null] as const,
    ),
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    name: names.get(row.user_id) ?? "Guest",
    body: row.body,
    createdAt: new Date(row.created_at).getTime(),
  }));
}
