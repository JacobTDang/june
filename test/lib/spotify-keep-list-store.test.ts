import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// keep-list-store is server code; its guard only resolves under Next's server build.
vi.mock("server-only", () => ({}));

import { supabaseKeepListStore } from "../../src/lib/spotify/keep-list-store";

function stubClient(status: number, body: unknown) {
  const calls: { url: URL; method: string }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: new URL(input.toString()), method: init?.method ?? "GET" });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  const db = createClient("https://project.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { db, calls };
}

describe("supabaseKeepListStore.libraryVideoIds", () => {
  it("calls library_video_ids() and returns its array", async () => {
    const { db, calls } = stubClient(200, ["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    expect(await supabaseKeepListStore(db).libraryVideoIds()).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
    expect(calls[0]!.url.pathname).toBe("/rest/v1/rpc/library_video_ids");
    expect(calls[0]!.method).toBe("POST");
  });

  it("fails loudly on a database error", async () => {
    const { db } = stubClient(500, { message: "permission denied", code: "42501" });
    await expect(supabaseKeepListStore(db).libraryVideoIds()).rejects.toThrow(/read the keep list/);
  });

  it("fails loudly on something that isn't a list of ids", async () => {
    const { db } = stubClient(200, { nope: true });
    await expect(supabaseKeepListStore(db).libraryVideoIds()).rejects.toThrow(/list of ids/);
  });
});
