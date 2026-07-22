import { describe, expect, it } from "vitest";
import { parseIso8601Duration } from "../../src/youtube/duration";

describe("parseIso8601Duration", () => {
  it.each([
    ["PT3M20S", 200_000],
    ["PT1H2M10S", 3_730_000],
    ["PT1H", 3_600_000],
    ["PT15M", 900_000],
    ["PT45S", 45_000],
    ["PT1H30S", 3_630_000], // hours + seconds, no minutes
    ["PT2H30M", 9_000_000],
    ["PT0S", 0],
    ["P1DT2H3M4S", 93_784_000],
    ["P1W", 604_800_000],
    ["PT100H", 360_000_000], // hours can exceed 24
  ])("parses %s", (input, expected) => {
    expect(parseIso8601Duration(input)).toBe(expected);
  });

  it("supports fractional seconds with a dot or comma", () => {
    expect(parseIso8601Duration("PT1.5S")).toBe(1_500);
    expect(parseIso8601Duration("PT1,5S")).toBe(1_500);
    expect(parseIso8601Duration("PT0.25S")).toBe(250);
  });

  it("does not confuse minutes with months", () => {
    expect(parseIso8601Duration("PT5M")).toBe(300_000);
    expect(parseIso8601Duration("PT1H15M")).toBe(4_500_000);
  });

  it.each([
    ["", /non-empty string/],
    ["PT", /no components/],
    ["P", /no components/],
    ["T1M", /malformed/],
    ["5M", /malformed/],
    ["banana", /malformed/],
    ["PT1H2H", /malformed/],
    ["-PT1H", /negative/],
    ["P1Y", /years and calendar months/],
    ["P1M", /years and calendar months/],
    ["P1Y2M3DT4H5M6S", /years and calendar months/],
  ])("throws on %s", (input, message) => {
    expect(() => parseIso8601Duration(input)).toThrow(message);
  });
});
