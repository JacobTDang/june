"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

    // Authenticate the realtime socket so RLS lets us receive change events.
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

  const { nowPlaying, queue, participants } = state;

  return (
    <main className="container">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <span className="pill">
          <span className="pill__dot" />
          {initial.id}
        </span>
        <button className="btn" onClick={onLeave}>
          Leave
        </button>
      </div>

      {offset !== null ? (
        <Player roomId={initial.id} nowPlaying={nowPlaying} offset={offset} />
      ) : (
        <p className="muted">Syncing clock…</p>
      )}

      {nowPlaying ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span>
            <strong>{nowPlaying.title}</strong>
            {nowPlaying.artist && <span className="muted"> · {nowPlaying.artist}</span>}
          </span>
          <button className="btn" onClick={() => void skipTrack(initial.id)}>
            Skip
          </button>
        </div>
      ) : (
        <p className="muted">Nothing playing — add a song to start the jam.</p>
      )}
      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.35rem" }}>
        Videos are streamed from YouTube.
      </p>

      <AddMusic roomId={initial.id} />

      <div
        className="row"
        style={{ justifyContent: "space-between", margin: "2rem 0 0.6rem" }}
      >
        <h2 style={{ fontSize: "1.1rem" }}>Up next ({queue.length})</h2>
        {queue.length > 0 && (
          <button className="btn" onClick={() => void clearQueue(initial.id)}>
            Clear queue
          </button>
        )}
      </div>
      {queue.length === 0 ? (
        <p className="muted">The queue is empty.</p>
      ) : (
        <ul className="list">
          {queue.map((t) => (
            <li
              key={t.id}
              className="card row"
              style={{ justifyContent: "space-between" }}
            >
              <span className="row">
                {t.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={t.thumbnailUrl} alt="" />
                )}
                <span>
                  <strong>{t.title}</strong>
                  <span className="muted">
                    {t.artist ? ` · ${t.artist}` : ""}
                    {t.addedByName ? ` — ${t.addedByName}` : ""}
                  </span>
                </span>
              </span>
              <button className="btn" onClick={() => void removeQueueItem(t.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 style={{ fontSize: "1.1rem", margin: "2rem 0 0.6rem" }}>
        In the room ({participants.length})
      </h2>
      <ul className="list">
        {participants.map((p) => (
          <li key={p.userId} className="muted">
            {p.name}
            {p.userId === me.userId ? " (you)" : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}
