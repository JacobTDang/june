"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, UserPlus } from "lucide-react";
import { Avatar } from "../avatar";
import {
  removeFriend,
  respondToRequest,
  searchUsers,
  sendFriendRequest,
  type FriendCard,
} from "@/src/lib/friends/actions";

function PersonRow({ card, children }: { card: FriendCard; children: React.ReactNode }) {
  return (
    <div className="friend">
      <Avatar name={card.displayName} url={card.avatarUrl} size={40} />
      <div className="friend__meta">
        <div className="friend__name">{card.displayName}</div>
        {card.username && <div className="friend__handle">@{card.username}</div>}
      </div>
      <div className="friend__actions">{children}</div>
    </div>
  );
}

export function FriendsClient({
  incoming,
  friends,
}: {
  incoming: FriendCard[];
  friends: FriendCard[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendCard[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setBusy(true);
    try {
      setResults(await searchUsers(query));
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      if (query.trim().length >= 2) setResults(await searchUsers(query));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function resultAction(card: FriendCard) {
    switch (card.state) {
      case "none":
        return (
          <button className="btn btn--sm" disabled={busy} onClick={() => act(() => sendFriendRequest(card.userId))}>
            <UserPlus size={14} />
            Add
          </button>
        );
      case "requested":
        return <span className="friend__tag">Requested</span>;
      case "incoming":
        return (
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => act(() => respondToRequest(card.userId, true))}>
            Accept
          </button>
        );
      case "friends":
        return <span className="friend__tag">Friends</span>;
    }
  }

  return (
    <div className="friends">
      <form className="friends__search" onSubmit={runSearch}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="btn" disabled={busy}>
          Search
        </button>
      </form>

      {results !== null && (
        <div className="friends__section">
          {results.length === 0 ? (
            <p className="muted">No one found by that username.</p>
          ) : (
            results.map((r) => <PersonRow key={r.userId} card={r}>{resultAction(r)}</PersonRow>)
          )}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="friends__section">
          <div className="eyebrow">Requests</div>
          {incoming.map((r) => (
            <PersonRow key={r.userId} card={r}>
              <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => act(() => respondToRequest(r.userId, true))}>
                <Check size={14} />
                Accept
              </button>
              <button className="btn btn--sm" disabled={busy} onClick={() => act(() => respondToRequest(r.userId, false))}>
                Decline
              </button>
            </PersonRow>
          ))}
        </div>
      )}

      <div className="friends__section">
        <div className="eyebrow">Your friends</div>
        {friends.length === 0 ? (
          <p className="muted">No friends yet — search a username, or add people from a jam.</p>
        ) : (
          friends.map((f) => (
            <PersonRow key={f.userId} card={f}>
              <button className="btn btn--sm" disabled={busy} onClick={() => act(() => removeFriend(f.userId))}>
                Remove
              </button>
            </PersonRow>
          ))
        )}
      </div>
    </div>
  );
}
