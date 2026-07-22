import { describe, expect, it } from "vitest";
import { rankSongResults } from "../../src/discovery/rank";
import type { MusicCandidate } from "../../src/discovery/itunes";

const song = (title: string, id = title): MusicCandidate => ({
  title,
  artist: "Artist",
  source: "itunes",
  sourceId: id,
});

const titles = (cs: MusicCandidate[]) => cs.map((c) => c.title);

describe("rankSongResults", () => {
  it("demotes karaoke/cover/tribute/instrumental/remix/live/sped-up below studio versions", () => {
    for (const noise of [
      "Song (Karaoke Version)",
      "Song (Acoustic Cover)",
      "Song (Tribute)",
      "Song - Instrumental",
      "Song (Club Remix)",
      "Song (Live at Wembley)",
      "Song (Sped Up)",
    ]) {
      const ranked = rankSongResults([song(noise, "noise"), song("Song", "studio")]);
      expect(titles(ranked)).toEqual(["Song", noise]);
    }
  });

  it("never drops rows — length is preserved", () => {
    const input = [song("A (Karaoke)"), song("B"), song("C (Cover)"), song("D")];
    expect(rankSongResults(input)).toHaveLength(4);
  });

  it("is a stable partition — relative order within each group is preserved", () => {
    const input = [song("B"), song("A (Karaoke)"), song("C"), song("D (Cover)")];
    expect(titles(rankSongResults(input))).toEqual(["B", "C", "A (Karaoke)", "D (Cover)"]);
  });

  it("does not demote real words that merely contain a noise token", () => {
    const input = [song("Undercover"), song("Live Your Life"), song("Cover Me")];
    // 'Undercover' has no word-boundary 'cover'; the others use 'live'/'cover'
    // as real title words, not version markers — all stay studio, order intact.
    expect(titles(rankSongResults(input))).toEqual(["Undercover", "Live Your Life", "Cover Me"]);
  });

  it("leaves an all-studio list untouched", () => {
    const input = [song("One More Time"), song("Around the World"), song("Digital Love")];
    expect(titles(rankSongResults(input))).toEqual([
      "One More Time",
      "Around the World",
      "Digital Love",
    ]);
  });
});
