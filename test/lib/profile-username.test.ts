import { describe, expect, it } from "vitest";
import { normalizeUsername } from "../../src/lib/profile/username";

describe("normalizeUsername", () => {
  it("accepts and lowercases a valid handle", () => {
    expect(normalizeUsername("  Jacob_23 ")).toEqual({ ok: true, value: "jacob_23" });
  });

  it("rejects too-short and too-long handles", () => {
    expect(normalizeUsername("jd")).toMatchObject({ ok: false });
    expect(normalizeUsername("a".repeat(21))).toMatchObject({ ok: false });
  });

  it("requires it to start with a letter", () => {
    expect(normalizeUsername("1jacob")).toMatchObject({ ok: false });
    expect(normalizeUsername("_jacob")).toMatchObject({ ok: false });
  });

  it("rejects disallowed characters", () => {
    expect(normalizeUsername("ja-cob")).toMatchObject({ ok: false });
    expect(normalizeUsername("ja cob")).toMatchObject({ ok: false });
    expect(normalizeUsername("ja.cob")).toMatchObject({ ok: false });
  });

  it("rejects reserved words", () => {
    expect(normalizeUsername("admin")).toMatchObject({ ok: false });
    expect(normalizeUsername("Friends")).toMatchObject({ ok: false });
    expect(normalizeUsername("api")).toMatchObject({ ok: false });
  });

  it("accepts a normal handle", () => {
    expect(normalizeUsername("uso")).toEqual({ ok: true, value: "uso" });
  });
});
