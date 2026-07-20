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
    <form onSubmit={submit} style={{ display: "flex", gap: "0.5rem", width: "100%" }}>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Room code"
        aria-label="Room code"
        className="input"
        style={{ flex: 1, textTransform: "uppercase", letterSpacing: "0.1em" }}
      />
      <button type="submit" className="btn">
        Join
      </button>
    </form>
  );
}
