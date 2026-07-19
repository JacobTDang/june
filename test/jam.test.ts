import { describe, expect, it } from "vitest";
import {
  createJam,
  currentPosition,
  enqueue,
  join,
  leave,
  removeFromQueue,
  skip,
  tick,
} from "../src/jam/index";
import type { Participant, Track } from "../src/jam/index";

const alice: Participant = { id: "alice", name: "Alice", joinedAt: 0 };
const bob: Participant = { id: "bob", name: "Bob", joinedAt: 0 };

const track = (over: Partial<Track> = {}): Track => ({
  id: "t1",
  videoId: "vid1",
  title: "Song One",
  durationMs: 180_000,
  addedBy: "alice",
  ...over,
});

/** A jam with Alice already joined. */
const withAlice = () => join(createJam("room"), alice);

describe("createJam", () => {
  it("starts empty and idle", () => {
    const jam = createJam("room");
    expect(jam).toEqual({
      id: "room",
      participants: [],
      queue: [],
      nowPlaying: null,
    });
  });

  it("requires an id", () => {
    expect(() => createJam("")).toThrow(/id is required/);
  });
});

describe("join / leave", () => {
  it("adds a participant", () => {
    const jam = join(createJam("room"), alice);
    expect(jam.participants).toEqual([alice]);
  });

  it("is idempotent for reconnecting participants", () => {
    const jam = join(join(createJam("room"), alice), alice);
    expect(jam.participants).toEqual([alice]);
  });

  it("does not mutate the original jam", () => {
    const before = createJam("room");
    join(before, alice);
    expect(before.participants).toEqual([]);
  });

  it("removes a participant", () => {
    const jam = leave(join(createJam("room"), alice), "alice");
    expect(jam.participants).toEqual([]);
  });

  it("throws when leaving a jam you are not in", () => {
    expect(() => leave(createJam("room"), "ghost")).toThrow(/not in jam/);
  });
});

describe("enqueue", () => {
  it("starts playing immediately when the jam is idle", () => {
    const jam = enqueue(withAlice(), track(), 1_000);
    expect(jam.nowPlaying).toEqual({ track: track(), startedAt: 1_000 });
    expect(jam.queue).toEqual([]);
  });

  it("appends to the queue while something is playing", () => {
    let jam = enqueue(withAlice(), track({ id: "t1" }), 1_000);
    jam = enqueue(jam, track({ id: "t2", videoId: "vid2" }), 2_000);
    expect(jam.nowPlaying?.track.id).toBe("t1");
    expect(jam.queue.map((t) => t.id)).toEqual(["t2"]);
  });

  it("rejects a track from someone not in the jam", () => {
    expect(() => enqueue(withAlice(), track({ addedBy: "bob" }), 0)).toThrow(
      /is not in jam/,
    );
  });

  it("rejects a duplicate track id", () => {
    const jam = enqueue(withAlice(), track({ id: "t1" }), 0);
    expect(() => enqueue(jam, track({ id: "t1" }), 1)).toThrow(/already in jam/);
  });

  it("rejects a non-positive duration", () => {
    expect(() => enqueue(withAlice(), track({ durationMs: 0 }), 0)).toThrow(
      /durationMs > 0/,
    );
  });
});

describe("currentPosition", () => {
  it("is null when idle", () => {
    expect(currentPosition(withAlice(), 5_000)).toBeNull();
  });

  it("is now minus startedAt while playing", () => {
    const jam = enqueue(withAlice(), track(), 1_000);
    expect(currentPosition(jam, 61_000)).toBe(60_000);
  });
});

describe("tick (auto-advance)", () => {
  const twoQueued = () => {
    let jam = enqueue(withAlice(), track({ id: "a", durationMs: 100 }), 0);
    jam = enqueue(jam, track({ id: "b", videoId: "vb", durationMs: 200 }), 0);
    return jam;
  };

  it("does nothing mid-track", () => {
    const jam = twoQueued();
    expect(tick(jam, 50)).toBe(jam);
  });

  it("advances to the next track back-to-back with no drift", () => {
    const jam = tick(twoQueued(), 100);
    expect(jam.nowPlaying).toEqual({
      track: track({ id: "b", videoId: "vb", durationMs: 200 }),
      startedAt: 100,
    });
    expect(jam.queue).toEqual([]);
  });

  it("chains forward across multiple tracks after a long gap", () => {
    let jam = enqueue(withAlice(), track({ id: "a", durationMs: 100 }), 0);
    jam = enqueue(jam, track({ id: "b", videoId: "vb", durationMs: 100 }), 0);
    jam = enqueue(jam, track({ id: "c", videoId: "vc", durationMs: 100 }), 0);
    jam = tick(jam, 250);
    expect(jam.nowPlaying?.track.id).toBe("c");
    expect(jam.nowPlaying?.startedAt).toBe(200);
    expect(jam.queue).toEqual([]);
  });

  it("stops playback when the queue empties", () => {
    let jam = enqueue(withAlice(), track({ id: "a", durationMs: 100 }), 0);
    jam = tick(jam, 150);
    expect(jam.nowPlaying).toBeNull();
    expect(jam.queue).toEqual([]);
  });

  it("is a no-op when idle", () => {
    const jam = withAlice();
    expect(tick(jam, 1_000)).toBe(jam);
  });
});

describe("skip", () => {
  it("advances to the next queued track starting at now", () => {
    let jam = enqueue(withAlice(), track({ id: "a", durationMs: 100 }), 0);
    jam = enqueue(jam, track({ id: "b", videoId: "vb", durationMs: 100 }), 0);
    jam = skip(jam, 50);
    expect(jam.nowPlaying).toEqual({
      track: track({ id: "b", videoId: "vb", durationMs: 100 }),
      startedAt: 50,
    });
    expect(jam.queue).toEqual([]);
  });

  it("stops playback when skipping the last track", () => {
    const jam = skip(enqueue(withAlice(), track(), 0), 10);
    expect(jam.nowPlaying).toBeNull();
  });

  it("throws when nothing is playing", () => {
    expect(() => skip(withAlice(), 0)).toThrow(/nothing is playing/);
  });
});

describe("removeFromQueue", () => {
  it("removes a queued track", () => {
    let jam = enqueue(withAlice(), track({ id: "a" }), 0);
    jam = enqueue(jam, track({ id: "b", videoId: "vb" }), 0);
    jam = removeFromQueue(jam, "b");
    expect(jam.queue).toEqual([]);
    expect(jam.nowPlaying?.track.id).toBe("a");
  });

  it("throws when the track is not queued", () => {
    expect(() => removeFromQueue(withAlice(), "nope")).toThrow(/not queued/);
  });
});
