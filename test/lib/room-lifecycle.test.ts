import { describe, expect, it } from "vitest";
import {
  ROOM_STALE_MS,
  deadRoomIds,
  roomIsLive,
  roomLastActivityMs,
  type RoomLifecycleRow,
} from "../../src/lib/room/lifecycle";

const NOW = 1_000_000_000_000; // fixed "now" in ms
const iso = (ms: number) => new Date(ms).toISOString();

function room(overrides: Partial<RoomLifecycleRow> = {}): RoomLifecycleRow {
  return {
    id: "AAA-AAA",
    created_at: iso(NOW),
    now_playing_video_id: null,
    now_playing_started_at: null,
    now_playing_duration_ms: null,
    ...overrides,
  };
}

describe("roomIsLive", () => {
  it("is live while the current track is still within its runtime", () => {
    const r = room({
      now_playing_video_id: "v1",
      now_playing_started_at: NOW - 60_000, // started a minute ago
      now_playing_duration_ms: 240_000, // 4-minute song → ends in the future
    });
    expect(roomIsLive(r, NOW)).toBe(true);
  });

  it("is not live once the current track has ended", () => {
    const r = room({
      now_playing_video_id: "v1",
      now_playing_started_at: NOW - 24 * 3_600_000, // started a day ago
      now_playing_duration_ms: 240_000, // 4-minute song → ended long ago
    });
    expect(roomIsLive(r, NOW)).toBe(false);
  });

  it("is not live with no track set", () => {
    expect(roomIsLive(room(), NOW)).toBe(false);
  });

  it("is not live when timing data is missing (can't confirm playback)", () => {
    expect(roomIsLive(room({ now_playing_video_id: "v1", now_playing_started_at: null }), NOW)).toBe(
      false,
    );
    expect(
      roomIsLive(room({ now_playing_video_id: "v1", now_playing_duration_ms: null }), NOW),
    ).toBe(false);
  });
});

describe("roomLastActivityMs", () => {
  it("uses created_at when nothing has ever played", () => {
    const r = room({ created_at: iso(NOW - 5_000) });
    expect(roomLastActivityMs(r)).toBe(NOW - 5_000);
  });

  it("uses the most recent track start when it is newer than creation", () => {
    const r = room({ created_at: iso(NOW - 10_000), now_playing_started_at: NOW - 2_000 });
    expect(roomLastActivityMs(r)).toBe(NOW - 2_000);
  });
});

describe("deadRoomIds", () => {
  it("keeps a genuinely live room no matter how old it is", () => {
    const live = room({
      id: "LIVE",
      created_at: iso(NOW - 30 * 3_600_000),
      now_playing_video_id: "v1",
      now_playing_started_at: NOW - 30_000,
      now_playing_duration_ms: 240_000,
    });
    expect(deadRoomIds([live], NOW, ROOM_STALE_MS)).toEqual([]);
  });

  it("flags a zombie whose track ended long ago", () => {
    const zombie = room({
      id: "ZOMB",
      created_at: iso(NOW - 25 * 3_600_000),
      now_playing_video_id: "v1",
      now_playing_started_at: NOW - 24 * 3_600_000,
      now_playing_duration_ms: 240_000,
    });
    expect(deadRoomIds([zombie], NOW, ROOM_STALE_MS)).toEqual(["ZOMB"]);
  });

  it("keeps a freshly created room that hasn't played anything yet", () => {
    const fresh = room({ id: "FRESH", created_at: iso(NOW - 4 * 60_000) }); // 4 minutes old
    expect(deadRoomIds([fresh], NOW, ROOM_STALE_MS)).toEqual([]);
  });

  it("flags an abandoned idle room past the TTL", () => {
    const abandoned = room({ id: "OLD", created_at: iso(NOW - 25 * 3_600_000) });
    expect(deadRoomIds([abandoned], NOW, ROOM_STALE_MS)).toEqual(["OLD"]);
  });

  it("sorts real rooms into keep vs. sweep in one pass", () => {
    const rooms: RoomLifecycleRow[] = [
      room({ id: "KEEP-live", now_playing_video_id: "v", now_playing_started_at: NOW - 1000, now_playing_duration_ms: 200_000 }),
      room({ id: "KEEP-fresh", created_at: iso(NOW - 60_000) }),
      room({ id: "DEAD-idle", created_at: iso(NOW - 26 * 3_600_000) }),
      room({ id: "DEAD-zombie", created_at: iso(NOW - 26 * 3_600_000), now_playing_video_id: "v", now_playing_started_at: NOW - 25 * 3_600_000, now_playing_duration_ms: 200_000 }),
    ];
    expect(deadRoomIds(rooms, NOW, ROOM_STALE_MS).sort()).toEqual(["DEAD-idle", "DEAD-zombie"]);
  });

  it("defaults the TTL to 12 hours", () => {
    expect(ROOM_STALE_MS).toBe(12 * 60 * 60 * 1000);
  });
});
