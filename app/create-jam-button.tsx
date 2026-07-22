"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "./button";
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
      <Button className="btn btn--primary btn--lg" onClick={create} pending={busy}>
        <Play size={17} fill="currentColor" strokeWidth={0} />
        Start a jam
      </Button>
      {error && <span className="muted">{error}</span>}
    </span>
  );
}
