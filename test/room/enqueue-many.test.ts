import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AddTrackInput } from "../../src/lib/room/types";
import { fakeSupabase } from "./fake-supabase";

// enqueue-many is server code; its guard only resolves under Next's server build.
vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ current: null as unknown }));
const enqueueTrack = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/supabase/server", () => ({ createClient: async () => supabase.current }));
vi.mock("../../src/lib/room/actions", () => ({ enqueueTrack }));

import { enqueueMany } from "../../src/lib/room/enqueue-many";

const track = (videoId: string): AddTrackInput => ({ videoId, title: `Title ${videoId}`, durationMs: 180_000 });

function room(tables: { queue?: string[]; playing?: string | null } = {}) {
  const fake = fakeSupabase({
    queue_items: (tables.queue ?? []).map((video_id) => ({ video_id })),
    rooms: [{ now_playing_video_id: tables.playing ?? null }],
    room_participants: [{ name: "Jacob" }],
  });
  supabase.current = fake.client;
  return fake;
}

const insertedVideoIds = (argsOf: ReturnType<typeof room>["argsOf"]) =>
  (argsOf("queue_items", "insert")[0]?.[0] as { video_id: string }[] | undefined)?.map((r) => r.video_id);

beforeEach(() => {
  enqueueTrack.mockReset();
});

describe("enqueueMany", () => {
  it("queues a video once when the same one is listed twice", async () => {
    const { argsOf } = room();

    const added = await enqueueMany("room-1", [track("a"), track("b"), track("a"), track("c"), track("b")]);

    expect(added).toBe(3);
    expect(enqueueTrack).toHaveBeenCalledTimes(1);
    expect(enqueueTrack).toHaveBeenCalledWith("room-1", track("a"));
    expect(insertedVideoIds(argsOf)).toEqual(["b", "c"]);
  });

  it("still skips videos already queued or playing in the room", async () => {
    const { argsOf } = room({ queue: ["b"], playing: "c" });

    const added = await enqueueMany("room-1", [track("a"), track("b"), track("c"), track("a")]);

    expect(added).toBe(1);
    expect(enqueueTrack).toHaveBeenCalledWith("room-1", track("a"));
    expect(insertedVideoIds(argsOf)).toBeUndefined();
  });
});
