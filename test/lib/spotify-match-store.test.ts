import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// match-store is server code; its guard only resolves under Next's server build.
vi.mock("server-only", () => ({}));

import { supabaseMatchStore } from "../../src/lib/spotify/match-store";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function stubClient(reply: Reply) {
  const calls: { url: URL; method: string; body: unknown; prefer: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: new URL(input.toString()),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      prefer: headers.get("Prefer"),
    });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  const db = createClient("https://project.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

describe("supabaseMatchStore.requeueFailed", () => {
  it("puts songs that failed before the cut-off back to pending, and counts them", async () => {
    const { db, calls } = stubClient({
      status: 200,
      body: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      headers: { "content-range": "0-2/3" },
    });

    const count = await supabaseMatchStore(db).requeueFailed(new Date("2026-09-27T12:00:00.000Z"));

    expect(count).toBe(3);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe("/rest/v1/songs");
    expect(call.url.searchParams.get("match_state")).toBe("eq.failed");
    expect(call.url.searchParams.get("matched_at")).toBe("lt.2026-09-27T12:00:00.000Z");
    expect(call.body).toEqual({ match_state: "pending", matched_at: null });
    // the count comes back in Content-Range, which PostgREST sends with the
    // updated rows' representation
    expect(call.prefer).toMatch(/count=exact/);
    expect(call.prefer).toMatch(/return=representation/);
  });

  it("fails loudly when the update fails", async () => {
    const { db } = stubClient({ status: 500, body: { message: "boom" } });

    await expect(supabaseMatchStore(db).requeueFailed(new Date())).rejects.toThrow(/requeue failed songs: boom/);
  });
});
