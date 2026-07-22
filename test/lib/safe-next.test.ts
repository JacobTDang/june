import { describe, expect, it } from "vitest";
import { safeNext } from "../../src/lib/safe-next";

describe("safeNext", () => {
  it("passes through internal absolute paths", () => {
    expect(safeNext("/room/ABC-123")).toBe("/room/ABC-123");
    expect(safeNext("/room/ABC-123?x=1")).toBe("/room/ABC-123?x=1");
    expect(safeNext("/")).toBe("/");
  });

  it("falls back when there is no next", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("rejects absolute URLs (open-redirect protection)", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com/room/x")).toBe("/");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("/\t/evil.com")).toBe("/");
  });

  it("rejects non-path schemes", () => {
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("mailto:x@y.com")).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(safeNext(null, "/home")).toBe("/home");
  });
});
