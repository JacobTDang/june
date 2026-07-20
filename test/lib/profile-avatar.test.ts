import { describe, expect, it } from "vitest";
import {
  MAX_AVATAR_BYTES,
  avatarObjectPath,
  avatarUrlWithCacheBust,
  validateAvatarFile,
} from "../../src/lib/profile/avatar";

describe("validateAvatarFile", () => {
  it("accepts a reasonable image", () => {
    expect(validateAvatarFile({ size: 500_000, type: "image/jpeg" })).toEqual({ ok: true });
  });

  it("accepts an empty content-type (sharp is the real validator)", () => {
    expect(validateAvatarFile({ size: 500_000, type: "" })).toEqual({ ok: true });
  });

  it("rejects an empty file", () => {
    expect(validateAvatarFile({ size: 0, type: "image/png" })).toMatchObject({ ok: false });
  });

  it("rejects a file over the size cap", () => {
    expect(validateAvatarFile({ size: MAX_AVATAR_BYTES + 1, type: "image/png" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects a non-image content-type", () => {
    expect(validateAvatarFile({ size: 100, type: "application/pdf" })).toMatchObject({ ok: false });
  });
});

describe("avatarObjectPath", () => {
  it("is scoped to the user's folder with a fixed name", () => {
    expect(avatarObjectPath("user-123")).toBe("user-123/avatar.webp");
  });
});

describe("avatarUrlWithCacheBust", () => {
  it("appends a version query to a bare URL", () => {
    expect(avatarUrlWithCacheBust("https://x/avatar.webp", 42)).toBe(
      "https://x/avatar.webp?v=42",
    );
  });

  it("uses & when the URL already has a query", () => {
    expect(avatarUrlWithCacheBust("https://x/a.webp?token=1", 42)).toBe(
      "https://x/a.webp?token=1&v=42",
    );
  });
});
