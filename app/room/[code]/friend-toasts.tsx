"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Avatar } from "../../avatar";
import { createClient } from "@/src/lib/supabase/client";
import { incomingRequestCard, respondToRequest, type FriendCard } from "@/src/lib/friends/actions";

const TIMEOUT_MS = 10_000;

/** One toast: auto-dismisses after 10s (request stays pending), with a draining bar. */
function FriendToast({
  card,
  onAccept,
  onDismiss,
}: {
  card: FriendCard;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    const t = setTimeout(() => onDismiss(card.userId), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [card.userId, onDismiss]);

  return (
    <motion.div
      className="ftoast"
      layout
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <div className="ftoast__row">
        <Avatar name={card.displayName} url={card.avatarUrl} size={34} />
        <div className="ftoast__meta">
          <div className="ftoast__title">{card.displayName}</div>
          <div className="ftoast__sub">wants to be friends</div>
        </div>
        <div className="ftoast__actions">
          <button className="btn btn--sm btn--primary" onClick={() => onAccept(card.userId)}>
            Accept
          </button>
          <button className="btn btn--sm" onClick={() => onDismiss(card.userId)}>
            Ignore
          </button>
        </div>
      </div>
      <div className="ftoast__barwrap">
        {reduce ? null : (
          <motion.div
            className="ftoast__bar"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: TIMEOUT_MS / 1000, ease: "linear" }}
          />
        )}
      </div>
    </motion.div>
  );
}

/** Listens for incoming friend requests via Realtime and shows a toast per request. */
export function FriendToasts({ meId }: { meId: string }) {
  const [cards, setCards] = useState<FriendCard[]>([]);

  const dismiss = useCallback((id: string) => {
    setCards((cs) => cs.filter((c) => c.userId !== id));
  }, []);

  const accept = useCallback(
    (id: string) => {
      void respondToRequest(id, true).finally(() => dismiss(id));
    },
    [dismiss],
  );

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
    });

    const channel = supabase
      .channel(`friend-reqs:${meId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friendships",
          filter: `addressee=eq.${meId}`,
        },
        (payload) => {
          const requesterId = (payload.new as { requester?: string }).requester;
          if (!requesterId) return;
          void incomingRequestCard(requesterId).then((card) => {
            if (!card) return;
            setCards((cs) => (cs.some((c) => c.userId === card.userId) ? cs : [...cs, card]));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId]);

  return (
    <div className="ftoasts" aria-live="polite">
      <AnimatePresence>
        {cards.map((c) => (
          <FriendToast key={c.userId} card={c} onAccept={accept} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
