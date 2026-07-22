import { describe, expect, it } from "vitest";
import { pickArtistMatch } from "../../src/discovery/artist-match";
import type { ArtistCandidate } from "../../src/discovery/itunes";

const artist = (name: string, artistId = name): ArtistCandidate => ({
  artistId,
  name,
  source: "itunes",
});

describe("pickArtistMatch", () => {
  it("matches an exact artist name", () => {
    const match = pickArtistMatch("Daft Punk", [artist("Daft Punk", "1")]);
    expect(match?.artistId).toBe("1");
  });

  it("is case- and whitespace-insensitive", () => {
    const match = pickArtistMatch("daft   punk", [artist("Daft Punk", "1")]);
    expect(match?.artistId).toBe("1");
  });

  it("ignores a leading 'the' on either side", () => {
    expect(pickArtistMatch("the weeknd", [artist("The Weeknd", "1")])?.artistId).toBe("1");
    expect(pickArtistMatch("weeknd", [artist("The Weeknd", "1")])?.artistId).toBe("1");
  });

  it("matches when the query is the leading tokens of the artist name", () => {
    expect(pickArtistMatch("kendrick", [artist("Kendrick Lamar", "1")])?.artistId).toBe("1");
    expect(pickArtistMatch("daft", [artist("Daft Punk", "1")])?.artistId).toBe("1");
  });

  it("does not match a suffix or interior fragment of the name", () => {
    expect(pickArtistMatch("punk", [artist("Daft Punk", "1")])).toBeNull();
    expect(pickArtistMatch("lamar", [artist("Kendrick Lamar", "1")])).toBeNull();
  });

  it("does not match a partial token (guards against char-prefix noise)", () => {
    expect(pickArtistMatch("dr", [artist("Drake", "1")])).toBeNull();
  });

  it("returns null when a song-title query does not name the top artist", () => {
    expect(pickArtistMatch("blinding lights", [artist("The Weeknd", "1")])).toBeNull();
  });

  it("scans in order and returns the first matching artist", () => {
    const match = pickArtistMatch("adele", [artist("Adele Tribute Band", "1"), artist("Adele", "2")]);
    expect(match?.artistId).toBe("2");
  });

  it("folds diacritics so accented names match plain queries", () => {
    expect(pickArtistMatch("beyonce", [artist("Beyoncé", "1")])?.artistId).toBe("1");
    expect(pickArtistMatch("Beyoncé", [artist("Beyonce", "1")])?.artistId).toBe("1");
  });

  it("returns null for an empty artist list", () => {
    expect(pickArtistMatch("anyone", [])).toBeNull();
  });
});
