import { describe, expect, it } from "vitest";
import { isMixPlaylistId, parsePlaylistId } from "../../src/youtube/url";

describe("parsePlaylistId", () => {
  it("reads the id from a playlist page link", () => {
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLabcdef123456")).toBe(
      "PLabcdef123456",
    );
  });

  it("reads it from a music.youtube playlist link", () => {
    expect(parsePlaylistId("https://music.youtube.com/playlist?list=OLAK5uy_abc123")).toBe(
      "OLAK5uy_abc123",
    );
  });

  it("ignores a link that also names a video, so sharing one track from a playlist adds that track", () => {
    // youtube's share menu appends the playlist to a watch link; the thing
    // being shared is still the video.
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123")).toBeNull();
    expect(parsePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=PLabc123")).toBeNull();
  });

  it("accepts a bare playlist id", () => {
    expect(parsePlaylistId("PLabcdef123456")).toBe("PLabcdef123456");
    expect(parsePlaylistId("  PLabcdef123456  ")).toBe("PLabcdef123456");
  });

  it("returns null for anything that isn't a playlist", () => {
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parsePlaylistId("dQw4w9WgXcQ")).toBeNull();
    expect(parsePlaylistId("not a link")).toBeNull();
    expect(parsePlaylistId("")).toBeNull();
  });
});

describe("isMixPlaylistId", () => {
  it("spots an auto-generated mix or radio list", () => {
    // These aren't real playlists: the API can't list their items, so they
    // need to be refused with an explanation rather than an API error.
    expect(isMixPlaylistId("RDabc123")).toBe(true);
    expect(isMixPlaylistId("RDMMabc123")).toBe(true);
  });

  it("leaves ordinary playlists alone", () => {
    expect(isMixPlaylistId("PLabcdef123456")).toBe(false);
    expect(isMixPlaylistId("OLAK5uy_abc123")).toBe(false);
  });
});
