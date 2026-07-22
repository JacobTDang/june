import { describe, expect, it } from "vitest";
import { normalizeQuery } from "../../src/discovery/normalize";

describe("normalizeQuery", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeQuery("  daft   punk\t")).toBe("daft punk");
  });

  it("leaves a clean query unchanged", () => {
    expect(normalizeQuery("daft punk one more time")).toBe("daft punk one more time");
  });

  it("strips trailing noise tokens", () => {
    expect(normalizeQuery("Blinding Lights official video")).toBe("Blinding Lights");
    expect(normalizeQuery("someone like you lyrics")).toBe("someone like you");
    expect(normalizeQuery("Levitating official audio")).toBe("Levitating");
  });

  it("strips bracketed noise and leaves no empty brackets", () => {
    expect(normalizeQuery("Blinding Lights (Official Video)")).toBe("Blinding Lights");
    expect(normalizeQuery("Halo [Official Music Video]")).toBe("Halo");
    expect(normalizeQuery("Circles (Lyric Video)")).toBe("Circles");
  });

  it("keeps feat./ft. credits", () => {
    expect(normalizeQuery("Loyal feat. Drake")).toBe("Loyal feat. Drake");
    expect(normalizeQuery("Work ft. Rihanna")).toBe("Work ft. Rihanna");
  });

  it("does not strip noise tokens embedded in real words", () => {
    expect(normalizeQuery("childhood memories")).toBe("childhood memories");
  });

  it("falls back to the collapsed original when noise removal empties it", () => {
    expect(normalizeQuery("official   video")).toBe("official video");
  });
});
