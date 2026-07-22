import { describe, expect, it } from "vitest";
import {
  describeYouTubeError,
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
