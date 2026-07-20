"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Link2 } from "lucide-react";
import { createClient } from "@/src/lib/supabase/client";
import {
  clearQueue,
  getRoomState,
  leaveRoom,
  removeQueueItem,
  skipTrack,
} from "@/src/lib/room/actions";
import type { RoomState } from "@/src/lib/room/types";
import { Player } from "./player";
import { NowPlaying } from "./now-playing";
import { AddMusic } from "./add-music";
import { sampleClockOffset } from "./clock-client";

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

  const refresh = useCallback(async () => {
    const next = await getRoomState(initial.id);
    if (next) setState(next);
  }, [initial.id]);

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
      /* clipboard blocked — the code is visible to read off and type anyway */
    }
  }

  const { nowPlaying, queue, participants } = state;

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
              Add the first song — it starts playing for everyone at once.
            </p>
          </div>
        )}
      </section>

      <div className="rule" />

      <AddMusic roomId={initial.id} />

      <div className="rule" />

      <div className="columns">
        <section>
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
            <ul className="list">
              {queue.map((t) => (
                <li key={t.id} className="track">
                  {t.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="thumb" src={t.thumbnailUrl} alt="" />
                  ) : (
                    <div className="thumb" />
                  )}
                  <div className="track__meta">
                    <div className="track__title">{t.title}</div>
                    <div className="track__sub">
                      {t.artist ?? ""}
                      {t.addedByName ? ` · ${t.addedByName}` : ""}
                    </div>
                  </div>
                  <button
                    className="btn btn--sm track__remove"
                    onClick={() => void removeQueueItem(t.id)}
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="section__head">
            <span className="eyebrow">In the room</span>
          </div>
          <ul className="people">
            {participants.map((p) => (
              <li key={p.userId} className="person">
                <span className="avatar">{(p.name[0] ?? "?").toUpperCase()}</span>
                <span>
                  {p.name}
                  {p.userId === me.userId ? " · you" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
