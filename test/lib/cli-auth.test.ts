import { describe, expect, it } from "vitest";
import {
  isOwner,
  parseAuthCallback,
  parseSessionCache,
  sessionUsable,
} from "../../src/lib/admin/cli-auth";

describe("isOwner", () => {
  it("matches the admin email case- and whitespace-insensitively", () => {
    expect(isOwner("Usosempai@Gmail.com", "usosempai@gmail.com")).toBe(true);
    expect(isOwner("  usosempai@gmail.com ", "usosempai@gmail.com")).toBe(true);
  });

  it("rejects a different, empty, or missing email", () => {
    expect(isOwner("someone@else.com", "usosempai@gmail.com")).toBe(false);
    expect(isOwner("", "usosempai@gmail.com")).toBe(false);
    expect(isOwner(null, "usosempai@gmail.com")).toBe(false);
    expect(isOwner(undefined, "usosempai@gmail.com")).toBe(false);
  });
});

describe("parseAuthCallback", () => {
  it("pulls the code out of the loopback callback", () => {
    expect(parseAuthCallback("/callback?code=abc123&state=x")).toEqual({ code: "abc123" });
  });

  it("surfaces an OAuth error, preferring the human description", () => {
    expect(
      parseAuthCallback("/callback?error=access_denied&error_description=You%20said%20no"),
    ).toEqual({ error: "You said no" });
  });

  it("treats a missing code (or a stray path) as an error", () => {
    expect("error" in parseAuthCallback("/callback")).toBe(true);
    expect("error" in parseAuthCallback("/favicon.ico")).toBe(true);
  });
});

describe("sessionUsable", () => {
  const base = { access_token: "a" };

  it("is usable while the access token is comfortably in date", () => {
    expect(sessionUsable({ ...base, expires_at: 2000 }, 1000)).toBe(true);
  });

  it("is not usable inside the expiry skew window or past it", () => {
    expect(sessionUsable({ ...base, expires_at: 1030 }, 1000)).toBe(false);
    expect(sessionUsable({ ...base, expires_at: 900 }, 1000)).toBe(false);
  });

  it("is not usable without an access token or an expiry", () => {
    expect(sessionUsable({ expires_at: 9999 }, 1000)).toBe(false);
    expect(sessionUsable({ access_token: "a" }, 1000)).toBe(false);
    expect(sessionUsable(null, 1000)).toBe(false);
  });
});

describe("parseSessionCache", () => {
  it("parses a well-formed cache", () => {
    const json = JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 123 });
    expect(parseSessionCache(json)).toEqual({
      access_token: "a",
      refresh_token: "r",
      expires_at: 123,
    });
  });

  it("returns null for malformed, empty, or incomplete input (fail safe → re-auth)", () => {
    expect(parseSessionCache("not json")).toBeNull();
    expect(parseSessionCache("")).toBeNull();
    expect(parseSessionCache(JSON.stringify({ access_token: "a" }))).toBeNull();
  });
});
