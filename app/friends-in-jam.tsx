"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./avatar";
import { getFriendsInJams, type FriendInJam } from "@/src/lib/friends/actions";
import { friendsPanelState } from "@/src/lib/friends/panel";

/** Home-screen prompt: friends who are in a jam right now, with a Join button. */
export function FriendsInJam() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendInJam[]>([]);
  // Separate from the list itself: an empty list before the first answer
  // means "unknown", not "nobody".
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void getFriendsInJams()
        .then((f) => {
          if (!alive) return;
          setFriends(f);
          setLoaded(true);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const state = friendsPanelState(loaded, friends.length);

  return (
    <div className="home-jams">
      <div className="eyebrow">Friends in a jam</div>
      {state === "loading" && <p className="faint home-jams__note">Checking…</p>}
      {state === "empty" && (
        <p className="faint home-jams__note">
          Nobody&rsquo;s in a jam right now. <a href="/friends">Find friends</a>
        </p>
      )}
      {state === "list" && (
      <ul className="home-jams__list">
        {friends.map((f) => (
          <li key={f.userId} className="home-jam">
            <Avatar name={f.displayName} url={f.avatarUrl} size={32} />
            <div className="home-jam__meta">
              <span className="home-jam__name">{f.displayName}</span>
              {/* Between tracks there is nothing playing, so it falls back to
                  presence rather than showing a stale title. */}
              {f.nowPlayingTitle ? (
                <span className="home-jam__track">
                  {f.nowPlayingTitle}
                  {f.nowPlayingArtist ? ` · ${f.nowPlayingArtist}` : ""}
                </span>
              ) : (
                <span className="friend__live">
                  <span className="live__dot" />
                  In a jam
                </span>
              )}
            </div>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => router.push(`/room/${encodeURIComponent(f.roomId)}`)}
            >
              Join
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
