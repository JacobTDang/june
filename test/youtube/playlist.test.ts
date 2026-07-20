import { describe, expect, it } from "vitest";
import { toPlaylist } from "../../src/youtube/playlist";
import type { YouTubePlaylist } from "../../src/youtube/schema";

function playlist(
  opts: {
    id?: string;
    title?: string;
    itemCount?: number;
    noCount?: boolean;
    thumbnails?: YouTubePlaylist["snippet"]["thumbnails"];
  } = {},
): YouTubePlaylist {
  const p: YouTubePlaylist = {
    id: opts.id ?? "pl1",
    snippet: { title: opts.title ?? "My Mix" },
  };
  if (opts.thumbnails) p.snippet.thumbnails = opts.thumbnails;
  if (!opts.noCount) p.contentDetails = { itemCount: opts.itemCount ?? 12 };
  return p;
}

describe("toPlaylist", () => {
  it("maps a playlist to a summary", () => {
    expect(
      toPlaylist(
        playlist({
          id: "abc",
          title: "Road Trip",
          itemCount: 42,
          thumbnails: { default: { url: "lo" }, high: { url: "hi" } },
        }),
      ),
    ).toEqual({ id: "abc", title: "Road Trip", itemCount: 42, thumbnailUrl: "hi" });
  });

  it("defaults itemCount to 0 when contentDetails is absent", () => {
    expect(toPlaylist(playlist({ noCount: true })).itemCount).toBe(0);
  });

  it("leaves thumbnailUrl undefined when there are no thumbnails", () => {
    expect(toPlaylist(playlist()).thumbnailUrl).toBeUndefined();
  });
});
