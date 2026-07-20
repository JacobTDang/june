"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom } from "@/src/lib/room/actions";

export function CreateJamButton({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const code = await createRoom(displayName);
      router.push(`/room/${code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="stack">
      <button className="btn btn--primary" onClick={create} disabled={busy}>
        {busy ? "Creating…" : "Create a jam"}
      </button>
      {error && <span className="muted">{error}</span>}
    </span>
  );
}
