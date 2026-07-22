"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./avatar";
import { getFriendsInJams, type FriendInJam } from "@/src/lib/friends/actions";

/** Home-screen prompt: friends who are in a jam right now, with a Join button. */
export function FriendsInJam() {
  const router = useRouter();
  const [friends, setFriends] = useState<FriendInJam[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void getFriendsInJams()
        .then((f) => {
          if (alive) setFriends(f);
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

  if (friends.length === 0) return null;

  return (
    <div className="home-jams">
      <div className="eyebrow">Friends in a jam</div>
      <ul className="home-jams__list">
        {friends.map((f) => (
          <li key={f.userId} className="home-jam">
            <Avatar name={f.displayName} url={f.avatarUrl} size={32} />
            <span className="home-jam__name">{f.displayName}</span>
            <span className="friend__live">
              <span className="live__dot" />
              In a jam
            </span>
            <button
              className="btn btn--sm btn--primary"
              onClick={() => router.push(`/room/${encodeURIComponent(f.roomId)}`)}
            >
              Join
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
