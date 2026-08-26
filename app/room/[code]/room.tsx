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
import type { RoomState } from "@/src/lib/room/types";
import { createAudioServer, type AudioServer } from "@/src/audio/client";
import { activeDownloadProgress, shouldPollAgain } from "@/src/audio/downloads";
import { alignedLogHeight } from "@/src/lib/room/align";
import { Player } from "./player";
import { NowPlaying } from "./now-playing";
import { AddMusic } from "./add-music";
import { Chat } from "./chat";
import { QueueSuggestions } from "./queue-suggestions";
import { FriendToasts } from "./friend-toasts";
import { RoomBackdrop } from "./room-backdrop";
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

/** One draggable queue row. Drag starts from the handle, so the window still
 *  scrolls and rows stay tappable on touch. */
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

  // User ids currently connected to the room's realtime channel, or null while
  // presence is unknown (before the first sync, or realtime down).
  const [online, setOnline] = useState<Set<string> | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const next = await getRoomState(initial.id);
    if (next) setState(next);
  }, [initial.id]);

  useEffect(() => {
    if (!reorderPending.current) setQueue(state.queue);
  }, [state.queue]);

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
    <main className="room rise">
      <RoomBackdrop nowPlaying={nowPlaying} />
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
        <button className="btn btn--sm" onClick={onLeave}>
          Leave
        </button>
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
                <div className="player-skeleton">
                  <span className="muted">Syncing…</span>
                </div>
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
        <section className="room__queue">
          <div className="section__head">
            <span className="eyebrow">Up next</span>
          </div>
          {queue.length === 0 ? (
            <QueueSuggestions roomId={initial.id} />
          ) : (
            <Reorder.Group axis="y" values={queue} onReorder={setQueue} className="queue" layoutScroll>
              {queue.map((t) => (
                <QueueRow
                  key={t.id}
                  track={t}
                  reduce={reduce}
                  downloadPercent={downloadProgress.get(t.videoId)}
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

          <AddMusic roomId={initial.id} />

          <div className="rule" />

          <Chat roomId={initial.id} meId={me.userId} />
        </aside>
      </div>
    </main>
  );
}
