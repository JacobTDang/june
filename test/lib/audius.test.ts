import { describe, expect, it } from "vitest";
import { audiusStreamUrl, parseAudiusTrack } from "../../src/lib/audius";

// The exact shape the live Audius trending endpoint returns.
const SAMPLE = {
  id: "XgRaaJy",
  title: "Dabow & Phydra - Megafauna",
  duration: 165,
  artwork: {
    "150x150": "https://cdn.example/x/150x150.jpg",
    "480x480": "https://cdn.example/x/480x480.jpg",
  },
  user: { name: "MONTA", handle: "montarecs" },
};

describe("audiusStreamUrl", () => {
  it("builds an app_name-tagged stream URL", () => {
    expect(audiusStreamUrl("XgRaaJy")).toBe(
      "https://api.audius.co/v1/tracks/XgRaaJy/stream?app_name=june",
    );
  });
});

describe("parseAudiusTrack", () => {
  it("maps a real Audius track to our shape", () => {
    expect(parseAudiusTrack(SAMPLE)).toEqual({
      id: "XgRaaJy",
      title: "Dabow & Phydra - Megafauna",
      artist: "MONTA",
      artworkUrl: "https://cdn.example/x/480x480.jpg",
      durationMs: 165000,
      streamUrl: "https://api.audius.co/v1/tracks/XgRaaJy/stream?app_name=june",
    });
  });

  it("falls back to 150x150 art, then to the handle when there's no name", () => {
    const t = parseAudiusTrack({
      id: "a",
      title: "t",
      artwork: { "150x150": "small.jpg" },
      user: { handle: "someone" },
    });
    expect(t?.artworkUrl).toBe("small.jpg");
    expect(t?.artist).toBe("someone");
  });

  it("uses null artwork and a fallback artist when both are missing", () => {
    const t = parseAudiusTrack({ id: "a", title: "t" });
    expect(t?.artworkUrl).toBeNull();
    expect(t?.artist).toBe("Unknown artist");
  });

  it("returns null when id or title is missing, or input is junk", () => {
    expect(parseAudiusTrack({ title: "no id" })).toBeNull();
    expect(parseAudiusTrack({ id: "x" })).toBeNull();
    expect(parseAudiusTrack(null)).toBeNull();
    expect(parseAudiusTrack("nope")).toBeNull();
  });
});
