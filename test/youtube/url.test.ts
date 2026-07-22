import { describe, expect, it } from "vitest";
import { parseVideoId } from "../../src/youtube/url";

describe("parseVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxx", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/watch?list=PLxx&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ?t=42  ", "dQw4w9WgXcQ"],
  ])("parses %s", (input, expected) => {
    expect(parseVideoId(input)).toBe(expected);
  });

  it.each([["not a link"], ["https://example.com"], [""], ["youtube.com/watch"]])(
    "returns null for %s",
    (input) => {
      expect(parseVideoId(input)).toBeNull();
    },
  );
});
