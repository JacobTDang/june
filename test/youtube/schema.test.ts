import { describe, expect, it } from "vitest";
import { parseVideoListResponse } from "../../src/youtube/schema";

/** Shaped like a real videos.list response, extra fields included. */
const realistic = {
  kind: "youtube#videoListResponse",
  etag: "etag-top",
  items: [
    {
      kind: "youtube#video",
      etag: "etag-item",
      id: "abc",
      snippet: {
        publishedAt: "2020-01-01T00:00:00Z",
        title: "Song",
        description: "…",
        channelTitle: "Band",
        liveBroadcastContent: "none",
        thumbnails: {
          default: { url: "d", width: 120, height: 90 },
          high: { url: "h", width: 480, height: 360 },
        },
      },
      contentDetails: { duration: "PT3M20S", dimension: "2d", definition: "hd" },
      status: { uploadStatus: "processed", privacyStatus: "public", embeddable: true },
    },
  ],
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
};

describe("parseVideoListResponse", () => {
  it("parses a realistic response and strips unknown fields", () => {
    const parsed = parseVideoListResponse(realistic);
    const item = parsed.items[0];
    expect(item?.id).toBe("abc");
    expect(item?.contentDetails.duration).toBe("PT3M20S");
    expect(item?.status?.embeddable).toBe(true);
    expect(item?.snippet.thumbnails?.high?.url).toBe("h");
    // Fields we didn't declare are dropped, not carried through.
    expect((item as Record<string, unknown>).etag).toBeUndefined();
  });

  it("accepts an item without a status block", () => {
    const parsed = parseVideoListResponse({
      items: [{ id: "x", snippet: { title: "t" }, contentDetails: { duration: "PT1M" } }],
    });
    expect(parsed.items[0]?.status).toBeUndefined();
  });

  it("throws when a required field is missing", () => {
    expect(() =>
      parseVideoListResponse({
        items: [{ id: "x", snippet: { title: "t" }, contentDetails: {} }],
      }),
    ).toThrow();
  });

  it("throws when a field has the wrong type", () => {
    expect(() =>
      parseVideoListResponse({
        items: [{ id: "x", snippet: { title: "t" }, contentDetails: { duration: 200 } }],
      }),
    ).toThrow();
  });

  it("throws when items is absent", () => {
    expect(() => parseVideoListResponse({})).toThrow();
  });
});
