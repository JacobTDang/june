"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/client";
import { fetchMessages, sendMessage } from "@/src/lib/room/chat";
import {
  MAX_MESSAGE_LENGTH,
  groupMessages,
  mergeMessages,
  normalizeMessageBody,
  type ChatMessage,
} from "@/src/lib/room/chat-message";

/** Backstop for a missed realtime event, matching the room's own fallback
 *  poll. Slower than the room's 3s: a late message is a smaller problem than
 *  a stale queue. */
const POLL_MS = 10_000;

/** How close to the bottom still counts as "reading the latest", and so keeps
 *  following new messages. Scrolled up past this, the log stays put rather
 *  than yanking the reader down mid-sentence. */
const FOLLOW_THRESHOLD_PX = 80;

/** About five lines. Past that the composer scrolls internally rather than
 *  eating the log it sits under. */
const MAX_INPUT_HEIGHT_PX = 116;

function timeLabel(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function Chat({ roomId, meId }: { roomId: string; meId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followRef = useRef(true);

  const load = useCallback(async () => {
    const incoming = await fetchMessages(roomId);
    setMessages((current) => mergeMessages(current, incoming));
  }, [roomId]);

  // Realtime for immediacy, a slow poll as the backstop. Both feed the same
  // merge, which is keyed on message id, so a message delivered twice appears
  // once. A failed load surfaces in the panel rather than throwing the room.
  useEffect(() => {
    let cancelled = false;
    const report = (err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the chat.");
    };

    void load().catch(report);

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;

    // Authorize the socket *before* subscribing. Subscribing first is a race:
    // the channel can open as anonymous, and since room_messages is
    // RLS-scoped to participants, an anonymous subscriber matches no rows and
    // silently receives nothing — the poll below then does all the work,
    // which is what "chat only updates if I refresh" actually looks like.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(`room-chat:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_messages",
            filter: `room_id=eq.${roomId}`,
          },
          // The row carries a user_id, not a display name; reloading the tail
          // keeps name resolution in one place instead of duplicating the
          // profile lookup here.
          () => void load().catch(report),
        )
        .subscribe();
    })();

    // A room stays open for hours and the access token doesn't. Without this
    // the socket keeps an expired token, deliveries stop, and the only cure
    // is a reload.
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    const timer = setInterval(() => void load().catch(report), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      auth.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [roomId, load]);

  // Follow the conversation only while the reader is already at the bottom.
  useEffect(() => {
    const log = logRef.current;
    if (log && followRef.current) log.scrollTop = log.scrollHeight;
  }, [messages]);

  function onScroll() {
    const log = logRef.current;
    if (!log) return;
    followRef.current =
      log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_THRESHOLD_PX;
  }

  // Grow the composer with its content instead of scrolling the text
  // sideways: reset to auto first so it shrinks back when lines are removed,
  // then cap it so a long message scrolls inside the box rather than pushing
  // the log off the screen.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, MAX_INPUT_HEIGHT_PX)}px`;
  }, [draft]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    if (normalizeMessageBody(draft) === null) {
      setError(
        draft.trim().length > MAX_MESSAGE_LENGTH
          ? `Keep it under ${MAX_MESSAGE_LENGTH} characters.`
          : null,
      );
      return;
    }

    setSending(true);
    setError(null);
    try {
      await sendMessage(roomId, draft);
      setDraft("");
      followRef.current = true;
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  const groups = groupMessages(messages);

  return (
    <section className="chat">
      <div className="section__head">
        <span className="eyebrow">Chat</span>
      </div>

      <div className="chat__log" ref={logRef} onScroll={onScroll}>
        {groups.length === 0 ? (
          <p className="muted chat__empty">Say something to the room.</p>
        ) : (
          groups.map((group) => (
            <div
              key={group.messages[0]!.id}
              className={`chat__group${group.userId === meId ? " chat__group--me" : ""}`}
            >
              <div className="chat__meta">
                <span className="chat__name">{group.name}</span>
                <span className="chat__time">{timeLabel(group.createdAt)}</span>
              </div>
              {group.messages.map((message) => (
                <p key={message.id} className="chat__body">
                  {message.body}
                </p>
              ))}
            </div>
          ))
        )}
      </div>

      {error && <p className="chat__error">{error}</p>}

      <form className="chat__form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="input chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter sends, because that's what a chat box does; Shift+Enter is
          // how you get the second line the box just made room for.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          rows={1}
          placeholder="Message the room"
          aria-label="Message the room"
          maxLength={MAX_MESSAGE_LENGTH + 1}
        />
        <button
          className="btn btn--sm"
          type="submit"
          disabled={sending || normalizeMessageBody(draft) === null}
          aria-label="Send message"
        >
          <SendHorizontal size={15} />
        </button>
      </form>
    </section>
  );
}
