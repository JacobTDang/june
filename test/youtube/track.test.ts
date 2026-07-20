import { describe, expect, it } from "vitest";
import type { YouTubeVideoItem } from "../../src/youtube/schema";
import { pickThumbnail, toTrack, videosToTracks } from "../../src/youtube/track";

type VideoOpts = {
  id?: string;
  title?: string;
  channelTitle?: string;
  noChannel?: boolean;
  duration?: string;
  embeddable?: boolean;
  live?: "none" | "live" | "upcoming";
  thumbnails?: YouTubeVideoItem["snippet"]["thumbnails"];
};

function video(opts: VideoOpts = {}): YouTubeVideoItem {
  const snippet: YouTubeVideoItem["snippet"] = { title: opts.title ?? "Song One" };
  if (!opts.noChannel) snippet.channelTitle = opts.channelTitle ?? "Artist";
  if (opts.live) snippet.liveBroadcastContent = opts.live;
  if (opts.thumbnails) snippet.thumbnails = opts.thumbnails;

  const item: YouTubeVideoItem = {
    id: opts.id ?? "vid1",
    snippet,
    contentDetails: { duration: opts.duration ?? "PT3M20S" },
  };
  if (opts.embeddable !== undefined) item.status = { embeddable: opts.embeddable };
  return item;
}

/** A deterministic id generator for tests. */
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe("pickThumbnail", () => {
  it("prefers the highest resolution available", () => {
    expect(
      pickThumbnail({
        default: { url: "d" },
        medium: { url: "m" },
        high: { url: "h" },
        standard: { url: "s" },
        maxres: { url: "x" },
      }),
    ).toBe("x");
    expect(pickThumbnail({ default: { url: "d" }, high: { url: "h" } })).toBe("h");
    expect(pickThumbnail({ default: { url: "d" } })).toBe("d");
  });

  it("returns undefined when there is nothing to pick", () => {
    expect(pickThumbnail(undefined)).toBeUndefined();
    expect(pickThumbnail({})).toBeUndefined();
  });
});

describe("toTrack", () => {
  it("maps a video into a track", () => {
    const t = toTrack(
      video({ id: "abc", title: "Hey", channelTitle: "Band", duration: "PT4M" }),
      "alice",
      "entry-1",
    );
    expect(t).toEqual({
      id: "entry-1",
      videoId: "abc",
      title: "Hey",
      durationMs: 240_000,
      addedBy: "alice",
      artist: "Band",
      thumbnailUrl: undefined,
    });
  });

  it("carries the best thumbnail when present", () => {
    const t = toTrack(
      video({ thumbnails: { default: { url: "lo" }, high: { url: "hi" } } }),
      "bob",
      "e1",
    );
    expect(t.thumbnailUrl).toBe("hi");
  });

  it("leaves artist undefined when the channel is absent", () => {
    expect(toTrack(video({ noChannel: true }), "a", "e").artist).toBeUndefined();
  });
});

describe("videosToTracks", () => {
  it("converts playable videos, assigning ids in order", () => {
    const { tracks, skipped } = videosToTracks(
      [video({ id: "a", duration: "PT1M" }), video({ id: "b", duration: "PT2M" })],
      "alice",
      counter(),
    );
    expect(skipped).toEqual([]);
    expect(tracks.map((t) => [t.id, t.videoId, t.durationMs])).toEqual([
      ["id-1", "a", 60_000],
      ["id-2", "b", 120_000],
    ]);
  });

  it("skips non-embeddable videos with a reason", () => {
    const { tracks, skipped } = videosToTracks(
      [video({ id: "x", title: "Nope", embeddable: false })],
      "alice",
      counter(),
    );
    expect(tracks).toEqual([]);
    expect(skipped).toEqual([{ videoId: "x", title: "Nope", reason: "not-embeddable" }]);
  });

  it("skips live broadcasts", () => {
    const { skipped } = videosToTracks(
      [video({ id: "l", live: "live", duration: "PT0S" })],
      "a",
      counter(),
    );
    expect(skipped[0]?.reason).toBe("live");
  });

  it("skips videos with no fixed duration", () => {
    const { skipped } = videosToTracks(
      [video({ id: "z", duration: "PT0S" })],
      "a",
      counter(),
    );
    expect(skipped[0]?.reason).toBe("no-duration");
  });

  it("reports not-embeddable ahead of live when both apply", () => {
    const { skipped } = videosToTracks(
      [video({ id: "q", embeddable: false, live: "live", duration: "PT0S" })],
      "a",
      counter(),
    );
    expect(skipped[0]?.reason).toBe("not-embeddable");
  });

  it("advances ids only for kept tracks in a mixed batch", () => {
    const { tracks, skipped } = videosToTracks(
      [
        video({ id: "a", duration: "PT1M" }),
        video({ id: "b", embeddable: false }),
        video({ id: "c", duration: "PT2M" }),
      ],
      "alice",
      counter(),
    );
    expect(tracks.map((t) => t.id)).toEqual(["id-1", "id-2"]);
    expect(tracks.map((t) => t.videoId)).toEqual(["a", "c"]);
    expect(skipped.map((s) => s.videoId)).toEqual(["b"]);
  });

  it("throws loudly on a malformed duration rather than skipping it", () => {
    expect(() =>
      videosToTracks([video({ id: "bad", duration: "banana" })], "a", counter()),
    ).toThrow(/malformed/);
  });
});
