"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Link2, UserPlus, GripVertical } from "lucide-react";
import {
  AnimatePresence,
  Reorder,
  animate,
  useDragControls,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { Avatar } from "../../avatar";
import {
  friendStatesFor,
  respondToRequest,
  sendFriendRequest,
} from "@/src/lib/friends/actions";
import type { FriendState } from "@/src/lib/friends/state";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/src/lib/supabase/client";
import {
  getRoomState,
  leaveRoom,
  removeQueueItem,
  reorderQueue,
  skipTrack,
  touchParticipant,
} from "@/src/lib/room/actions";
import { visibleParticipants } from "@/src/lib/room/presence";
import {
  confirmedRemovals,
  removeById,
  restoreAt,
  withoutPending,
} from "@/src/lib/room/queue-edit";
import { rowExit, swipeAxis, swipeOffset, swipeRelease } from "@/src/lib/room/swipe";
import { unreadCount } from "@/src/lib/room/unread";
import type { RoomState } from "@/src/lib/room/types";
import { createAudioServer, type AudioServer } from "@/src/audio/client";
import { activeDownloadProgress, shouldPollAgain } from "@/src/audio/downloads";
import { alignedLogHeight } from "@/src/lib/room/align";
import { Player } from "./player";
import { NowPlaying } from "./now-playing";
import { ThemeToggle } from "@/app/_terminal/theme-toggle";
import { AddMusic } from "./add-music";
import { Chat } from "./chat";
import { QueueSuggestions } from "./queue-suggestions";
import { FriendToasts } from "./friend-toasts";
import { sampleClockOffset } from "./clock-client";

type QueueItem = RoomState["queue"][number];

/** How often to say we're still in the room. Comfortably inside the five
 *  minutes the friends list allows, even when a backgrounded tab throttles
 *  timers to roughly one a minute. */
const HEARTBEAT_MS = 30_000;

/** How often to poll download progress while it can matter. */
const DOWNLOAD_POLL_MS = 2500;
/** Consecutive poll failures tolerated before giving up — a decorative bar
 *  must never take the room down or spam mp3server that's already struggling. */
const DOWNLOAD_POLL_MAX_FAILURES = 3;
/** How long a just-finished bar stays visible while it fades and collapses. */
const DOWNLOAD_FADE_MS = 600;

// Separate cached instance from player.tsx's — that module owns its own and
// isn't touched here (another worktree is editing it concurrently).
let cachedAudioServer: AudioServer | null = null;
function audioServer(): AudioServer {
  if (!cachedAudioServer) {
    const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
    if (!baseUrl) throw new Error("NEXT_PUBLIC_MP3SERVER_URL is not configured.");
    const supabase = createClient();
    cachedAudioServer = createAudioServer({
      baseUrl,
      getAccessToken: async () =>
        (await supabase.auth.getSession()).data.session?.access_token ?? null,
    });
  }
  return cachedAudioServer;
}

/** Holds a just-finished download's bar at 100% long enough to fade: the job
 *  disappearing from the poll (percent going from a number to undefined) is
 *  the completion signal, since a terminal job is dropped from the map. */
function useDownloadBar(percent: number | undefined): { percent: number; fading: boolean } | null {
  const [bar, setBar] = useState<{ percent: number; fading: boolean } | null>(null);
  const hadJob = useRef(false);

  useEffect(() => {
    if (percent !== undefined) {
      hadJob.current = true;
      setBar({ percent, fading: false });
      return;
    }
    if (!hadJob.current) return;
    hadJob.current = false;
    setBar({ percent: 100, fading: true });
    const timer = setTimeout(() => setBar(null), DOWNLOAD_FADE_MS);
    return () => clearTimeout(timer);
  }, [percent]);

  return bar;
}

/** One draggable queue row. Reordering drags from the handle, so the window
 *  still scrolls and rows stay tappable on touch; a sideways drag anywhere else
 *  on the row removes it. */
function QueueRow({
  track,
  reduce,
  downloadPercent,
  onRemove,
  onDragStart,
  onCommit,
}: {
  track: QueueItem;
  reduce: boolean;
  /** Active download percent for this track's videoId, or undefined when
   *  there's no download in flight for it. */
  downloadPercent: number | undefined;
  onRemove: () => void;
  onDragStart: () => void;
  onCommit: () => void;
}) {
  const controls = useDragControls();
  const bar = useDownloadBar(downloadPercent);
  // The row rides this under the finger. Reorder.Item takes a caller's x as its
  // own, so the swipe and the reorder drag (y) share one transform without
  // fighting, and the exit animation carries on from wherever the finger let go.
  const x = useMotionValue(0);
  /** The swipe in progress: null between gestures, and null the moment the
   *  gesture turns out to belong to the scroller instead. */
  const swipe = useRef<{
    pointer: number;
    startX: number;
    startY: number;
    width: number;
    horizontal: boolean;
  } | null>(null);
  /** Set by a swipe so the click that follows it isn't treated as a tap. */
  const swiped = useRef(false);

  // A row put back after a refused delete comes back mid-departure, wherever
  // the swipe and the exit animation had carried it. Sit it back down.
  const present = useIsPresent();
  useEffect(() => {
    if (present) x.set(0);
  }, [present, x]);

  function springBack() {
    if (reduce) {
      x.set(0);
      return;
    }
    void animate(x, 0, { type: "spring", stiffness: 600, damping: 45 });
  }

  function onPointerDown(e: React.PointerEvent<HTMLLIElement>) {
    swiped.current = false;
    // The handle owns reordering and the X owns its tap; a gesture starting on
    // either of them is not a swipe.
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe.current = {
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      width: e.currentTarget.getBoundingClientRect().width,
      horizontal: false,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const gesture = swipe.current;
    if (!gesture || gesture.pointer !== e.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (!gesture.horizontal) {
      const axis = swipeAxis(dx, dy);
      if (axis === "undecided") return;
      if (axis === "vertical") {
        // Someone is scrolling. Let go of it entirely — this row gets no say
        // for the rest of the gesture.
        swipe.current = null;
        return;
      }
      gesture.horizontal = true;
      // Only now: capturing on the way down would take clicks off the controls.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    x.set(swipeOffset(dx));
  }

  function onPointerUp(e: React.PointerEvent<HTMLLIElement>) {
    const gesture = swipe.current;
    swipe.current = null;
    if (!gesture || gesture.pointer !== e.pointerId || !gesture.horizontal) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    swiped.current = true;
    if (swipeRelease(e.clientX - gesture.startX, gesture.width) === "remove") {
      onRemove();
      return;
    }
    springBack();
  }

  function onPointerCancel() {
    // The browser took the gesture for a scroll after all.
    const gesture = swipe.current;
    swipe.current = null;
    if (gesture?.horizontal) springBack();
  }

  return (
    <Reorder.Item
      value={track}
      className="track"
      style={{ x }}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onCommit}
      transition={reduce ? { duration: 0 } : undefined}
      exit={rowExit(reduce)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={(e: React.MouseEvent) => {
        if (!swiped.current) return;
        swiped.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
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
        // draggable={false}: without it a mouse swipe that starts on the
        // artwork becomes a native image drag instead.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={track.thumbnailUrl} alt="" draggable={false} />
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
      {bar && (
        <div
          className={`track__progress${bar.fading ? " track__progress--done" : ""}`}
          aria-hidden="true"
        >
          <div className="track__progress__fill" style={{ width: `${bar.percent}%` }} />
        </div>
      )}
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
  /** Rows removed here whose delete is still in flight. They keep the row off
   *  screen until the server's own list agrees, so a poll mid-delete can't put
   *  it back for a beat. */
  const removing = useRef<Set<string>>(new Set());
  /** A delete the server refused, said plainly rather than left to a queue that
   *  silently disagrees with everyone else's. */
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** True while a row is on its way out, so the empty-queue suggestions wait
   *  for it to land instead of appearing underneath it. */
  const [exiting, setExiting] = useState(false);

  // User ids currently connected to the room's realtime channel, or null while
  // presence is unknown (before the first sync, or realtime down).
  const [online, setOnline] = useState<Set<string> | null>(null);
  /** Which of the rail's two views is showing. The rail holds both so the
   *  left column can be the artwork alone. */
  const [railView, setRailView] = useState<"queue" | "chat">("queue");
  /** Messages in the log, and how many had arrived last time chat was open. */
  const [chatTotal, setChatTotal] = useState(0);
  const [chatSeen, setChatSeen] = useState(0);
  const unread = unreadCount({ total: chatTotal, seen: chatSeen, visible: railView === "chat" });
  // Opening chat marks everything in it read; so does a message arriving while
  // it is already open.
  useEffect(() => {
    if (railView === "chat") setChatSeen(chatTotal);
  }, [railView, chatTotal]);
  const mainRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const next = await getRoomState(initial.id);
    if (next) setState(next);
  }, [initial.id]);

  useEffect(() => {
    if (reorderPending.current) return;
    const pending = removing.current;
    // Retire the tombstones the server has caught up with, then take the rest
    // of its list as the truth.
    for (const id of confirmedRemovals(pending, state.queue)) pending.delete(id);
    setQueue(withoutPending(state.queue, pending));
  }, [state.queue]);

  // A refused removal explains itself and then gets out of the way.
  useEffect(() => {
    if (!removeError) return;
    const timer = setTimeout(() => setRemoveError(null), 6000);
    return () => clearTimeout(timer);
  }, [removeError]);

  // Per-videoId download percent for queue rows currently downloading.
  const [downloadProgress, setDownloadProgress] = useState<Map<string, number>>(new Map());
  // Keyed on the queue's videoIds (not the QueueItem objects) so a reorder
  // alone doesn't restart polling, only an actual change to which tracks are
  // queued does.
  const queueVideoIds = queue.map((t) => t.videoId).join(",");

  // Poll download progress only while it can matter: there's something
  // queued, and the poll is still finding — or could still find — an active
  // job for one of those tracks. Empty polls are tolerated up to
  // EMPTY_POLL_LIMIT so a job registered just after the queue changed is not
  // missed, then the loop goes idle rather than hammering the server; a queue
  // change (queueVideoIds) restarts it.
  useEffect(() => {
    if (queueVideoIds === "") {
      setDownloadProgress(new Map());
      return;
    }
    const relevantIds = new Set(queueVideoIds.split(","));
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let emptyPolls = 0;

    async function poll() {
      let jobs;
      try {
        jobs = await audioServer().listDownloads();
      } catch {
        // Fail loud would mean surfacing this, but a decorative progress bar
        // is not worth breaking the room over. Retry on the same cadence,
        // and after a few misses in a row assume the server (or its config)
        // is down and stop rather than polling forever.
        if (cancelled) return;
        failures += 1;
        if (failures >= DOWNLOAD_POLL_MAX_FAILURES) {
          setDownloadProgress(new Map());
          return;
        }
        timer = setTimeout(() => void poll(), DOWNLOAD_POLL_MS);
        return;
      }
      if (cancelled) return;
      failures = 0;

      const relevant = new Map(
        [...activeDownloadProgress(jobs)].filter(([videoId]) => relevantIds.has(videoId)),
      );
      setDownloadProgress(relevant);
      emptyPolls = relevant.size === 0 ? emptyPolls + 1 : 0;
      if (!shouldPollAgain(emptyPolls)) return; // idle until the queue changes
      timer = setTimeout(() => void poll(), DOWNLOAD_POLL_MS);
    }

    // No background polling: skip the kickoff while hidden, and stop/resume
    // as visibility changes.
    if (document.visibilityState !== "hidden") void poll();

    function onVisibility() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== "hidden") {
        // A fresh window on return: whatever went idle while the tab was in
        // the background deserves one more look.
        emptyPolls = 0;
        void poll();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queueVideoIds]);

  // Keep the chat composer on the search bar's line. It has to be measured
  // rather than set: the now-playing block only exists while something is
  // playing, so the search bar moves down about 85px when a track starts and
  // back up when the room falls idle. Runs after paint, watches the layout for
  // changes, and stands down below the three-rail breakpoint where the columns
  // stack and there is nothing to line up with.
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof ResizeObserver === "undefined") return;
    const desktop = window.matchMedia("(min-width: 981px)");

    const sync = () => {
      const search = main.querySelector<HTMLElement>(".add__search");
      const log = main.querySelector<HTMLElement>(".chat__log");
      const form = main.querySelector<HTMLElement>(".chat__form");
      // A collapsed chat has no log to size, and a stacked layout has nothing
      // to align to.
      if (!desktop.matches || !search || !log || !form || log.offsetParent === null) {
        main.style.removeProperty("--chat-log-h");
        return;
      }
      const height = alignedLogHeight({
        searchTop: search.getBoundingClientRect().top,
        logTop: log.getBoundingClientRect().top,
        gap: parseFloat(getComputedStyle(form).marginTop) || 0,
      });
      // Only write on a real change: the observer below watches this same
      // subtree, and rewriting an identical value invites a loop.
      if (main.style.getPropertyValue("--chat-log-h") !== `${height}px`) {
        main.style.setProperty("--chat-log-h", `${height}px`);
      }
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(main);
    desktop.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", sync);
    };
  }, [state.nowPlaying?.videoId, state.participants.length, queue.length]);

  /**
   * Remove a track. The row leaves now and the server is told after: waiting on
   * a round-trip to acknowledge a tap is the delay this is here to kill. The
   * tombstone in `removing` holds the row off screen until the server's list
   * agrees, and a refused delete puts it back exactly where it was.
   */
  function removeTrack(track: QueueItem) {
    const { next, removed, index } = removeById(queue, track.id);
    if (!removed) return;
    removing.current.add(track.id);
    setRemoveError(null);
    setExiting(true);
    setQueue(next);
    void removeQueueItem(track.id)
      .catch((error: unknown) => {
        removing.current.delete(track.id);
        setQueue((current) => restoreAt(current, removed, index));
        setRemoveError(
          error instanceof Error && error.message
            ? `Couldn’t remove “${removed.title}” — ${error.message}`
            : `Couldn’t remove “${removed.title}”.`,
        );
      })
      .finally(() => {
        void refresh();
      });
  }

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

    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    // Authorize the socket before subscribing: subscribing first can open the
    // channel as anonymous, and RLS then hides the very rows it's watching.
    // The 3s poll below papers over it here, which is exactly why it went
    // unnoticed until chat (with a slower poll) made it visible.
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      const room = supabase
        .channel(`room:${initial.id}`, { config: { presence: { key: me.userId } } })
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
          {
            event: "*",
            schema: "public",
            table: "room_participants",
            filter: `room_id=eq.${initial.id}`,
          },
          onChange,
        )
        .on("presence", { event: "sync" }, () => {
          setOnline(new Set(Object.keys(room.presenceState())));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void room.track({ online_at: Date.now() });
          } else {
            // Channel dropped or errored: presence is unknown, so fall back to
            // showing full membership instead of an empty room.
            setOnline(null);
          }
        });
      channel = room;
    })();

    // Rooms outlive access tokens; hand the socket each refreshed one so
    // deliveries don't quietly stop after an hour.
    const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    const poll = setInterval(onChange, 3000);

    // Tell the room we're still here, so friends stop seeing us in a jam the
    // moment we're gone. Sent on visibility changes too: a phone waking up
    // should re-appear immediately rather than at the next tick.
    const beat = () => void touchParticipant(initial.id).catch(() => {});
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
      auth.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [initial.id, refresh, me.userId]);

  // Estimate the client→server clock offset once, for synced playback.
  useEffect(() => {
    sampleClockOffset()
      .then(setOffset)
      .catch(() => setOffset(0));
  }, []);

  function onLeave() {
    // Leaving is immediate: the room is behind you the moment you press it, and
    // the server call finishes on its own behind the navigation. If it fails
    // this page is already gone, so there is nowhere here to say so — instead
    // make the page we land on re-read the server, where the jam card still
    // offering to take you back is the honest report that you never left.
    void leaveRoom(initial.id).catch(() => {
      router.refresh();
    });
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

  const { nowPlaying } = state;
  // Membership filtered down to who's actually connected right now.
  const participants = visibleParticipants(state.participants, online, me.userId);

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
    <>
      <main className="room rise">
      <FriendToasts meId={me.userId} />
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
          <div className="room__who">
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
          </div>
        <div className="room__barR">
          <ThemeToggle />
          <button className="btn btn--sm" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>

      <div className="room__main" ref={mainRef}>
        <div className="room__center">
          <section className="stage">
            <div className="section__head">
              {nowPlaying && <span className="eyebrow">Now playing</span>}
            </div>
            <div className="player-wrap">
              {offset !== null ? (
                <Player
                  roomId={initial.id}
                  nowPlaying={nowPlaying}
                  offset={offset}
                  upNext={queue.slice(0, 2)}
                />
              ) : (
                // Holds the player's shape while the clock is sampled, and
                // says nothing: the wait is under a second, and a labelled
                // box announcing it is more disruptive than the pause itself.
                // The artwork fades in when it arrives.
                <div className="player-skeleton" aria-hidden />
              )}
            </div>
            {nowPlaying && (
              <NowPlaying
                nowPlaying={nowPlaying}
                offset={offset ?? 0}
                onSkip={() => void skipTrack(initial.id)}
              />
            )}
          </section>
        </div>

        <aside className="room__rail">
        {/* One rail, two views. Both stay mounted: chat keeps its scroll
            position and its messages, and the queue keeps whatever search
            results are open, so switching costs nothing either way. */}
        <div className="rail__switch" role="tablist" aria-label="Room panel">
          <button
            role="tab"
            aria-selected={railView === "queue"}
            className="rail__tab"
            onClick={() => setRailView("queue")}
          >
            Music
          </button>
          <button
            role="tab"
            aria-selected={railView === "chat"}
            className="rail__tab"
            onClick={() => setRailView("chat")}
          >
            Chat
            {unread > 0 && (
              <span className="rail__badge" aria-label={`${unread} unread`}>
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </div>
        <div className="rail__stack">
        <div className="rail__view" data-active={railView === "queue"} aria-hidden={railView !== "queue"}>
        <section className="room__queue">
          <div className="section__head">
            <span className="eyebrow">Up next</span>
          </div>
          {/* The list stays mounted even when empty — an empty ul is nothing on
              screen, and it's what lets the last row animate out instead of
              being unmounted mid-flight along with its group. */}
          <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="queue" layoutScroll>
            <AnimatePresence initial={false} onExitComplete={() => setExiting(false)}>
              {queue.map((t) => (
                <QueueRow
                  key={t.id}
                  track={t}
                  reduce={reduce}
                  downloadPercent={downloadProgress.get(t.videoId)}
                  onRemove={() => removeTrack(t)}
                  onDragStart={() => {
                    reorderPending.current = true;
                  }}
                  onCommit={commitReorder}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
          {removeError && <p className="queue__error">{removeError}</p>}
          {queue.length === 0 && !exiting && <QueueSuggestions roomId={initial.id} />}
        </section>

          <AddMusic roomId={initial.id} />
        </div>
        <div
          className="rail__view"
          data-active={railView === "chat"}
          aria-hidden={railView !== "chat"}
        >
          <Chat roomId={initial.id} meId={me.userId} onCount={setChatTotal} />
        </div>
        </div>
        </aside>
      </div>
    </main>
    </>
  );
}
