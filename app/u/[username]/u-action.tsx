"use client";

import { useState } from "react";
import { respondToRequest, sendFriendRequest, type PublicProfile } from "@/src/lib/friends/actions";
import type { FriendState } from "@/src/lib/friends/state";

export function UProfileAction({ profile }: { profile: PublicProfile }) {
  const [state, setState] = useState<FriendState>(profile.state);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile.isMe) {
    return (
      <a href="/profile" className="btn btn--sm">
        Edit your profile
      </a>
    );
  }

  if (!profile.signedIn) {
    return (
      <a
        href={`/?next=${encodeURIComponent(`/u/${profile.username}`)}`}
        className="btn btn--primary"
      >
        Sign in to add
      </a>
    );
  }

  async function run(fn: () => Promise<void>, next: FriendState) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setState(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  let control: React.ReactNode;
  if (state === "friends") {
    control = <span className="friend__tag">✓ Friends</span>;
  } else if (state === "requested") {
    control = <span className="friend__tag">Request sent</span>;
  } else if (state === "incoming") {
    control = (
      <button
        className="btn btn--primary"
        disabled={busy}
        onClick={() => run(() => respondToRequest(profile.userId, true), "friends")}
      >
        Accept request
      </button>
    );
  } else {
    control = (
      <button
        className="btn btn--primary"
        disabled={busy}
        onClick={() => run(() => sendFriendRequest(profile.userId), "requested")}
      >
        Add friend
      </button>
    );
  }

  return (
    <div className="u__action">
      {control}
      {error && <span className="profile__msg profile__msg--err">{error}</span>}
    </div>
  );
}
