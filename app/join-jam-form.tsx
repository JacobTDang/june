"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinJamForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) router.push(`/room/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={submit} className="join">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Room code"
        aria-label="Room code"
        className="input"
      />
      <button type="submit" className="btn">
        Join
      </button>
    </form>
  );
}
