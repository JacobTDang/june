import { expect, it } from "vitest";
import { PREPARING_TIMEOUT_MS, shouldSkipPreparing } from "../../src/audio/preparing";

it("waits while the download is younger than the timeout", () => {
  expect(shouldSkipPreparing(1_000, 1_000 + PREPARING_TIMEOUT_MS - 1)).toBe(false);
});

it("skips once the timeout elapses", () => {
  expect(shouldSkipPreparing(1_000, 1_000 + PREPARING_TIMEOUT_MS)).toBe(true);
});
