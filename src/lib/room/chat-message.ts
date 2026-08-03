/** Pure chat logic: what counts as a sendable message, how a log absorbs
 *  messages arriving from two sources at once, and how it reads as blocks
 *  rather than one line per message. No Supabase, no React. */

/** Matches the check constraint on room_messages.body — the database is the
 *  real gate; this keeps the client from sending what it would reject. */
export const MAX_MESSAGE_LENGTH = 500;

/** A new group starts when the same author speaks again after this long. */
const GROUP_GAP_MS = 5 * 60_000;

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  body: string;
  /** Epoch ms. */
  createdAt: number;
}

export interface ChatGroup {
  userId: string;
  name: string;
  createdAt: number;
  messages: ChatMessage[];
}

/**
 * The message as it should be sent, or null if it isn't sendable. Rejects
 * rather than truncates an over-long message: silently cutting someone's
 * sentence in half sends something they didn't write.
 */
export function normalizeMessageBody(input: string): string | null {
  const body = input.trim();
  if (body.length === 0 || body.length > MAX_MESSAGE_LENGTH) return null;
  return body;
}

/**
 * Fold `incoming` into `existing`, keyed by id. Realtime delivery and the
 * polling fallback both feed this, so the same message routinely arrives
 * twice; the id decides. Sorted by send time (id breaks ties) so an
 * out-of-order delivery still lands in its place rather than at the end.
 */
export function mergeMessages(
  existing: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);

  return [...byId.values()].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Consecutive messages from one author collapse into a single block, so a
 * burst reads as someone talking rather than as their name repeated. A long
 * pause starts a new block even for the same author.
 */
export function groupMessages(messages: readonly ChatMessage[]): ChatGroup[] {
  const groups: ChatGroup[] = [];

  for (const message of messages) {
    const current = groups[groups.length - 1];
    const continues =
      current !== undefined &&
      current.userId === message.userId &&
      message.createdAt - current.messages[current.messages.length - 1]!.createdAt < GROUP_GAP_MS;

    if (continues) {
      current.messages.push(message);
    } else {
      groups.push({
        userId: message.userId,
        name: message.name,
        createdAt: message.createdAt,
        messages: [message],
      });
    }
  }

  return groups;
}
