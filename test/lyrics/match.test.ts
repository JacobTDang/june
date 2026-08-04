import { describe, expect, it } from "vitest";
import { cleanArtist, cleanTitle, pickBestMatch, type LyricsCandidate } from "../../src/lyrics/match";

describe("cleanTitle", () => {
  it("strips the video furniture YouTube titles carry", () => {
    expect(cleanTitle("BELLAKEO (Video Oficial)")).toBe("BELLAKEO");
    expect(cleanTitle("Robbers (Official Video)")).toBe("Robbers");
    expect(cleanTitle("Cats [Lyric Video]")).toBe("Cats");
    expect(cleanTitle("Sweet (Official Audio)")).toBe("Sweet");
    expect(cleanTitle("Glory Box (Remastered 2024)")).toBe("Glory Box");
    expect(cleanTitle("Fade Into You (HD)")).toBe("Fade Into You");
  });

  it("keeps a bracket that belongs to the song", () => {
    // Dropping these would search for the wrong song entirely.
    expect(cleanTitle("Sleep (Mixed)")).toBe("Sleep (Mixed)");
    expect(cleanTitle("Everything In Its Right Place (Live)")).toBe(
      "Everything In Its Right Place (Live)",
    );
  });

  it("drops a trailing artist credit added by the uploader", () => {
    expect(cleanTitle("BELLAKEO - Peso Pluma, Anitta")).toBe("BELLAKEO");
  });

  it("leaves an ordinary title alone", () => {
    expect(cleanTitle("Weird Fishes / Arpeggi")).toBe("Weird Fishes / Arpeggi");
    expect(cleanTitle("")).toBe("");
  });
});

describe("cleanArtist", () => {
  it("removes YouTube's auto-channel suffixes", () => {
    expect(cleanArtist("The Poles - Topic")).toBe("The Poles");
    expect(cleanArtist("MitskiVEVO")).toBe("Mitski");
    expect(cleanArtist("Portishead - Topic ")).toBe("Portishead");
  });

  it("leaves a real artist name alone", () => {
    expect(cleanArtist("Cigarettes After Sex")).toBe("Cigarettes After Sex");
    expect(cleanArtist("")).toBe("");
  });
});

function candidate(over: Partial<LyricsCandidate>): LyricsCandidate {
  return {
    trackName: "Glory Box",
    artistName: "Portishead",
    durationSeconds: 310,
    syncedLyrics: "[00:01.00]a",
    plainLyrics: "a",
    ...over,
  };
}

describe("pickBestMatch", () => {
  it("prefers a synced result over a plain one", () => {
    const plain = candidate({ trackName: "exact", syncedLyrics: null });
    const synced = candidate({ trackName: "other" });

    expect(pickBestMatch([plain, synced], { durationMs: 310_000 })).toBe(synced);
  });

  it("among synced results, takes the closest duration", () => {
    const near = candidate({ durationSeconds: 308 });
    const far = candidate({ durationSeconds: 200 });

    expect(pickBestMatch([far, near], { durationMs: 310_000 })).toBe(near);
  });

  it("refuses a result whose duration is nowhere near the track", () => {
    // A wrong-length match is a different recording — a live cut, an edit —
    // and its timings would drift against what the room is hearing.
    const wrong = candidate({ durationSeconds: 120 });
    expect(pickBestMatch([wrong], { durationMs: 310_000 })).toBeNull();
  });

  it("falls back to a plain result when nothing is synced", () => {
    const plain = candidate({ syncedLyrics: null });
    expect(pickBestMatch([plain], { durationMs: 310_000 })).toBe(plain);
  });

  it("ignores results carrying no lyrics at all", () => {
    const empty = candidate({ syncedLyrics: null, plainLyrics: null });
    expect(pickBestMatch([empty], { durationMs: 310_000 })).toBeNull();
  });

  it("takes any duration when the track's own is unknown", () => {
    const any = candidate({ durationSeconds: 999 });
    expect(pickBestMatch([any], { durationMs: 0 })).toBe(any);
  });

  it("returns null for no candidates", () => {
    expect(pickBestMatch([], { durationMs: 310_000 })).toBeNull();
  });
});
