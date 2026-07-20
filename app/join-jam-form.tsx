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
    <form onSubmit={submit} className="row">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Room code"
        aria-label="Room code"
        style={{
          padding: "0.55rem 0.8rem",
          borderRadius: 10,
          border: "1px solid var(--line)",
          background: "var(--card)",
          fontSize: "0.95rem",
          fontFamily: "var(--font-sans)",
        }}
      />
      <button type="submit" className="btn">
        Join
      </button>
    </form>
  );
}
