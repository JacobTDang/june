import { describe, expect, it, vi } from "vitest";
import {
  describeYouTubeError,
  runYouTube,
  youTubeNoticeText,
} from "../../src/lib/supabase/youtube-error";

describe("describeYouTubeError", () => {
  it("classifies missing OAuth credentials as not-configured", () => {
    const r = describeYouTubeError(
      new Error("Google OAuth is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)."),
    );
    expect(r.kind).toBe("not-configured");
  });

  it("classifies a missing API key as not-configured", () => {
    expect(describeYouTubeError(new Error("YOUTUBE_API_KEY is not configured.")).kind).toBe(
      "not-configured",
    );
  });

  it("classifies a missing connection as not-connected", () => {
    expect(describeYouTubeError(new Error("Connect your YouTube account first.")).kind).toBe(
      "not-connected",
    );
    expect(
      describeYouTubeError(new Error("No YouTube refresh token available — connect YouTube again."))
        .kind,
    ).toBe("not-connected");
  });

  it("classifies anything else as a genuine failure and preserves the message", () => {
    const r = describeYouTubeError(new Error("YouTube token refresh failed (401). invalid_grant"));
    expect(r.kind).toBe("failed");
    expect(r.message).toContain("401");
  });

  it("handles non-Error values without throwing", () => {
    expect(describeYouTubeError("boom")).toEqual({ kind: "failed", message: "boom" });
  });
});

describe("youTubeNoticeText", () => {
  it("gives calm copy for configuration and connection states", () => {
    expect(youTubeNoticeText({ kind: "not-configured", message: "raw" })).not.toContain("raw");
    expect(youTubeNoticeText({ kind: "not-connected", message: "raw" })).not.toContain("raw");
  });

  it("passes the raw message through for genuine failures (fail loud)", () => {
    expect(youTubeNoticeText({ kind: "failed", message: "refresh failed (401)" })).toContain("401");
  });
});

describe("runYouTube", () => {
  it("returns the data on success", async () => {
    const r = await runYouTube(async () => [1, 2, 3]);
    expect(r).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it("turns a not-connected throw into calm copy without logging", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runYouTube(async () => {
      throw new Error("Connect your YouTube account first.");
    });
    expect(r).toEqual({
      ok: false,
      notice: "Connect your YouTube account from the home page to import playlists.",
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("turns a not-configured throw into calm copy", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runYouTube(async () => {
      throw new Error("YOUTUBE_API_KEY is not configured.");
    });
    expect(r).toEqual({ ok: false, notice: "YouTube isn’t set up on this server yet." });
    spy.mockRestore();
  });

  it("surfaces a genuine failure's real message and logs it (fail loud)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runYouTube(async () => {
      throw new Error("That video can't be played here (embedding disabled).");
    });
    expect(r).toEqual({
      ok: false,
      notice: "That video can't be played here (embedding disabled).",
    });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
