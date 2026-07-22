"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Link2, UserPlus, GripVertical } from "lucide-react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { Avatar } from "../../avatar";
import {
  friendStatesFor,
  respondToRequest,
  sendFriendRequest,
} from "@/src/lib/friends/actions";
import type { FriendState } from "@/src/lib/friends/state";
import { createClient } from "@/src/lib/supabase/client";
import {
  clearQueue,
  getRoomState,
  leaveRoom,
  removeQueueItem,
  reorderQueue,
  skipTrack,
} from "@/src/lib/room/actions";
import type { RoomState } from "@/src/lib/room/types";
import { Player } from "./player";
import { NowPlaying } from "./now-playing";
import { AddMusic } from "./add-music";
import { sampleClockOffset } from "./clock-client";

type QueueItem = RoomState["queue"][number];

/** One draggable queue row. Drag starts from the handle, so the window still
 *  scrolls and rows stay tappable on touch. */
function QueueRow({
  track,
  reduce,
  onRemove,
  onDragStart,
  onCommit,
}: {
  track: QueueItem;
  reduce: boolean;
  onRemove: () => void;
  onDragStart: () => void;
  onCommit: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={track}
      className="track"
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onCommit}
      transition={reduce ? { duration: 0 } : undefined}
    >
      <button
        type="button"
        className="track__handle"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
      >
        <GripVertical size={15} />
      </button>
      {track.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={track.thumbnailUrl} alt="" />
      ) : (
        <div className="thumb" />
      )}
      <div className="track__meta">
        <div className="track__title">{track.title}</div>
        <div className="track__sub">
          {track.artist ?? ""}
          {track.addedByName ? ` · ${track.addedByName}` : ""}
        </div>
      </div>
      <button className="btn btn--sm track__remove" onClick={onRemove} aria-label="Remove">
        <X size={14} />
      </button>
    </Reorder.Item>
  );
}

export function Room({
  initial,
  me,
}: {
  initial: RoomState;
  me: { userId: string; name: string };
}) {
  const router = useRouter();
  const [state, setState] = useState<RoomState>(initial);
  const [offset, setOffset] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion() ?? false;

  // Local, drag-reorderable copy of the queue. Kept in sync with the server
  // except while a local reorder is being persisted (so a poll can't revert it).
  const [queue, setQueue] = useState<QueueItem[]>(initial.queue);
  const reorderPending = useRef(false);

  const refresh = useCallback(async () => {
    const next = await getRoomState(initial.id);
    if (next) setState(next);
  }, [initial.id]);

  useEffect(() => {
    if (!reorderPending.current) setQueue(state.queue);
  }, [state.queue]);

  function commitReorder() {
    reorderPending.current = true;
    void reorderQueue(
      initial.id,
      queue.map((t) => t.id),
    )
      .catch(() => {
        /* realtime will bring the true order back */
      })
      .finally(() => {
        reorderPending.current = false;
        void refresh();
      });
  }

  // Keep the shared state fresh: Realtime for instant updates, plus a polling
  // fallback so it works even if a realtime event is missed.
  useEffect(() => {
    const supabase = createClient();
    const onChange = () => {
      void refresh();
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
    });

    const channel = supabase
      .channel(`room:${initial.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${initial.id}` },
        onChange,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${initial.id}` },
        onChange,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_participants", filter: `room_id=eq.${initial.id}` },
        onChange,
      )
      .subscribe();

    const poll = setInterval(onChange, 3000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [initial.id, refresh]);

  // Estimate the client→server clock offset once, for synced playback.
  useEffect(() => {
    sampleClockOffset()
      .then(setOffset)
      .catch(() => setOffset(0));
  }, []);

  async function onLeave() {
    await leaveRoom(initial.id);
    router.push("/");
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${initial.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked - the code is visible to read off and type anyway */
    }
  }

  const { nowPlaying, participants } = state;

  // Friend state for the other people in the room, so we can offer to add them.
  const otherKey = participants
    .filter((p) => p.userId !== me.userId)
    .map((p) => p.userId)
    .join(",");
  const [friendStates, setFriendStates] = useState<Record<string, FriendState>>({});
  const [fbusy, setFbusy] = useState(false);

  const refreshFriendStates = useCallback(async () => {
    if (otherKey === "") {
      setFriendStates({});
      return;
    }
    try {
      setFriendStates(await friendStatesFor(otherKey.split(",")));
    } catch {
      /* leave prior states; the add controls just won't refresh */
    }
  }, [otherKey]);

  useEffect(() => {
    void refreshFriendStates();
  }, [refreshFriendStates]);

  async function addFriendAction(fn: () => Promise<void>) {
    setFbusy(true);
    try {
      await fn();
      await refreshFriendStates();
    } finally {
      setFbusy(false);
    }
  }

  function participantAction(userId: string, name: string) {
    if (userId === me.userId) return null;
    const st = friendStates[userId];
    if (!st || st === "friends") return null;
    if (st === "requested") return <span className="friend__tag">Requested</span>;
    if (st === "incoming") {
      return (
        <button
          className="btn btn--sm"
          disabled={fbusy}
          onClick={() => void addFriendAction(() => respondToRequest(userId, true))}
        >
          Accept
        </button>
      );
    }
    return (
      <button
        className="add__btn"
        aria-label={`Add ${name} as a friend`}
        disabled={fbusy}
        onClick={() => void addFriendAction(() => sendFriendRequest(userId))}
      >
        <UserPlus size={15} />
      </button>
    );
  }

  return (
    <main className="room rise">
      <div className="room__bar">
        <div className="room__barL">
          <span className="live">
            <span className="live__dot" />
            Live
          </span>
          <button className="code" onClick={copyInvite} title="Copy invite link">
            <Link2 size={12} />
            {copied ? "Copied" : initial.id.replace(/-/g, " · ")}
          </button>
        </div>
        <button className="btn btn--sm" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="room__main">
        <section className="room__queue">
          <div className="section__head">
            <span className="eyebrow">Up next</span>
            {queue.length > 0 && (
              <button className="btn btn--sm" onClick={() => void clearQueue(initial.id)}>
                Clear
              </button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="muted">Nothing queued yet.</p>
          ) : (
            <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="queue">
              {queue.map((t) => (
                <QueueRow
                  key={t.id}
                  track={t}
                  reduce={reduce}
                  onRemove={() => void removeQueueItem(t.id)}
                  onDragStart={() => {
                    reorderPending.current = true;
                  }}
                  onCommit={commitReorder}
                />
              ))}
            </Reorder.Group>
          )}
        </section>

        <div className="room__center">
          <section className="stage">
            {nowPlaying ? (
              <>
                <div className="player-wrap">
                  {offset !== null ? (
                    <Player roomId={initial.id} nowPlaying={nowPlaying} offset={offset} />
                  ) : (
                    <div className="player-skeleton">
                      <span className="muted">Syncing…</span>
                    </div>
                  )}
                </div>
                <NowPlaying
                  nowPlaying={nowPlaying}
                  offset={offset ?? 0}
                  onSkip={() => void skipTrack(initial.id)}
                />
              </>
            ) : (
              <div className="empty">
                <div className="empty__title">Your room is ready.</div>
                <p className="muted" style={{ marginTop: "0.5rem" }}>
                  Add the first song. It starts playing for everyone at once.
                </p>
              </div>
            )}
          </section>

          <div className="rule" />

          <AddMusic roomId={initial.id} />
        </div>

        <section className="room__people">
          <div className="section__head">
            <span className="eyebrow">In the room</span>
          </div>
          <ul className="people">
            {participants.map((p) => (
              <li key={p.userId} className="person">
                <Avatar name={p.name} url={p.avatarUrl} size={28} />
                <span className="person__name">
                  {p.name}
                  {p.userId === me.userId ? " · you" : ""}
                </span>
                {participantAction(p.userId, p.name)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
