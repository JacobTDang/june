import { describe, expect, it } from "vitest";
import {
  EMPTY_POLL_LIMIT,
  activeDownloadProgress,
  describeDownloadFailure,
  shouldPollAgain,
  trackDownloadState,
  type DownloadProgressJob,
  type DownloadStateJob,
} from "../../src/audio/downloads";
import { downloadsResponseSchema } from "../../src/audio/schema";

function job(overrides: Partial<DownloadProgressJob> & { id?: string }): DownloadProgressJob {
  const { id: _id, ...rest } = overrides;
  return {
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    status: "running",
    progress: 0,
    ...rest,
  };
}

describe("activeDownloadProgress", () => {
  it("includes only jobs that are queued or running", () => {
    const jobs = [
      job({ id: "1", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "running", progress: 40 }),
      job({ id: "2", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", status: "completed", progress: 100 }),
      job({ id: "3", url: "https://www.youtube.com/watch?v=ccccccccccc", status: "failed", progress: 10 }),
      job({ id: "4", url: "https://www.youtube.com/watch?v=ddddddddddd", status: "canceled", progress: 5 }),
      job({ id: "5", url: "https://www.youtube.com/watch?v=eeeeeeeeeee", status: "queued", progress: 0 }),
    ];

    const result = activeDownloadProgress(jobs);

    expect(result).toEqual(
      new Map([
        ["aaaaaaaaaaa", 40],
        ["eeeeeeeeeee", 0],
      ]),
    );
  });

  it("lets the newest job's status decide the video's state, ignoring older jobs for the same video", () => {
    // Newest first: a fresh running job for a video that also has an older
    // completed job (e.g. a re-download) must still show a bar.
    const stillActive = [
      job({ id: "new", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "running", progress: 70 }),
      job({ id: "old", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "completed", progress: 100 }),
    ];
    expect(activeDownloadProgress(stillActive)).toEqual(new Map([["aaaaaaaaaaa", 70]]));

    // Newest first: a completed job for a video must hide the bar even if an
    // older, now-stale job for the same video is still marked running.
    const nowDone = [
      job({ id: "new", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "completed", progress: 100 }),
      job({ id: "old", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "running", progress: 30 }),
    ];
    expect(activeDownloadProgress(nowDone)).toEqual(new Map());
  });

  it("skips jobs whose url has no parseable videoId", () => {
    const jobs = [job({ url: "not a youtube url", status: "running", progress: 50 })];

    expect(activeDownloadProgress(jobs)).toEqual(new Map());
  });

  it("clamps progress to 0-100", () => {
    const jobs = [
      job({ url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", status: "running", progress: -10 }),
      job({ url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", status: "running", progress: 150 }),
    ];

    expect(activeDownloadProgress(jobs)).toEqual(
      new Map([
        ["aaaaaaaaaaa", 0],
        ["bbbbbbbbbbb", 100],
      ]),
    );
  });

  it("returns an empty map for no jobs", () => {
    expect(activeDownloadProgress([])).toEqual(new Map());
  });
});

describe("shouldPollAgain", () => {
  it("keeps polling through the empty polls right after a queue change", () => {
    // The download job for a freshly queued track is created a beat after the
    // queue changes, so the first polls legitimately find nothing.
    expect(shouldPollAgain(0)).toBe(true);
    expect(shouldPollAgain(1)).toBe(true);
    expect(shouldPollAgain(EMPTY_POLL_LIMIT - 1)).toBe(true);
  });

  it("stops once the empty polls run out, so an idle room isn't polled forever", () => {
    expect(shouldPollAgain(EMPTY_POLL_LIMIT)).toBe(false);
    expect(shouldPollAgain(EMPTY_POLL_LIMIT + 1)).toBe(false);
  });

  it("allows enough time for a download to be registered", () => {
    expect(EMPTY_POLL_LIMIT).toBeGreaterThanOrEqual(4);
  });
});

function stateJob(overrides: Partial<DownloadStateJob>): DownloadStateJob {
  return {
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    status: "running",
    progress: 0,
    error: null,
    ...overrides,
  };
}

describe("trackDownloadState", () => {
  it("reports how far along the track's own download is", () => {
    const jobs = [stateJob({ status: "running", progress: 42 })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "active", percent: 42 });
  });

  it("treats a queued job as active at its reported percent", () => {
    const jobs = [stateJob({ status: "queued", progress: 0 })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "active", percent: 0 });
  });

  it("surfaces a failure instead of hiding it", () => {
    // The whole point: a job that died must not look the same as one that
    // succeeded, which is what dropping every terminal job used to do.
    const jobs = [
      stateJob({
        status: "failed",
        error: "ERROR: [youtube] aaaaaaaaaaa: Sign in to confirm you’re not a bot. Use --cookies",
      }),
    ];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({
      kind: "failed",
      reason: "YouTube blocked this download",
    });
  });

  it("is idle for a completed job, so a stored track shows no bar", () => {
    const jobs = [stateJob({ status: "completed", progress: 100 })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "idle" });
  });

  it("is idle when the user cancelled it", () => {
    const jobs = [stateJob({ status: "canceled", progress: 20 })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "idle" });
  });

  it("is idle when no job exists for the track at all", () => {
    const jobs = [stateJob({ url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "idle" });
  });

  it("lets the newest job decide, so a retry supersedes an earlier failure", () => {
    // Newest first. A user who re-adds a track after a failure must see the
    // new attempt's progress, not the old attempt's error.
    const jobs = [
      stateJob({ status: "running", progress: 15 }),
      stateJob({ status: "failed", error: "video unavailable" }),
    ];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "active", percent: 15 });
  });

  it("clamps a nonsense percent rather than rendering a broken bar", () => {
    expect(trackDownloadState([stateJob({ progress: 150 })], "aaaaaaaaaaa")).toEqual({
      kind: "active",
      percent: 100,
    });
    expect(trackDownloadState([stateJob({ progress: -5 })], "aaaaaaaaaaa")).toEqual({
      kind: "active",
      percent: 0,
    });
  });

  it("ignores jobs whose url has no parseable videoId", () => {
    const jobs = [stateJob({ url: "not a youtube url", status: "failed", error: "boom" })];

    expect(trackDownloadState(jobs, "aaaaaaaaaaa")).toEqual({ kind: "idle" });
  });
});

describe("describeDownloadFailure", () => {
  it("explains the bot check in words a listener can act on", () => {
    // This is the failure that cost an evening: every job died in ~1s with
    // this, and the room just said "Preparing this track…" for 90 seconds.
    expect(
      describeDownloadFailure(
        "ERROR: [youtube] 8IjOQmwlGmk: Sign in to confirm you’re not a bot. Use --cookies-from-browser",
      ),
    ).toBe("YouTube blocked this download");
  });

  it.each([
    ["ERROR: [youtube] x: Video unavailable", "This video isn’t available"],
    ["ERROR: [youtube] x: Private video", "This video isn’t available"],
    ["ERROR: [youtube] x: This video has been removed", "This video isn’t available"],
    ["ERROR: [youtube] x: Video not available in your country", "This video isn’t available"],
    ["ERROR: [youtube] x: Join this channel — members-only content", "This video isn’t available"],
    ["ERROR: [youtube] x: Sign in to confirm your age, age-restricted", "This video isn’t available"],
  ])("maps %j to a plain-language reason", (error, expected) => {
    expect(describeDownloadFailure(error)).toBe(expected);
  });

  it("explains a track rejected for length", () => {
    expect(describeDownloadFailure("video too long: 9000s > 3600s")).toBe(
      "This track is too long",
    );
  });

  it("explains the server running out of room", () => {
    expect(
      describeDownloadFailure(
        "insufficient disk space: 300MB free, this job needs about 40MB and 512MB must stay free",
      ),
    ).toBe("The audio server is out of space");
  });

  it("falls back to something honest when the error is unrecognised", () => {
    expect(describeDownloadFailure("some new yt-dlp error nobody has seen")).toBe(
      "The download failed",
    );
  });

  it("falls back when the server sent no error text at all", () => {
    expect(describeDownloadFailure(null)).toBe("The download failed");
    expect(describeDownloadFailure(undefined)).toBe("The download failed");
  });

  it("never leaks a raw yt-dlp command line into the room", () => {
    // These strings tell a listener to pass --cookies to a program they have
    // never heard of, on a server they cannot reach.
    const raw =
      "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ";
    const described = describeDownloadFailure(raw);
    expect(described).not.toContain("--cookies");
    expect(described).not.toContain("yt-dlp");
    expect(described).not.toContain("http");
  });
});

describe("the wire seam between mp3server and the room", () => {
  // The failure reason has to survive Zod, which strips undeclared keys. A
  // field that parses away leaves the room narrating "Preparing…" over a job
  // that is already dead — the exact bug this whole path exists to fix.
  const wireJob = {
    id: "f087df82-1a22-4394-8339-67e115c11ce1",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    kind: "single",
    status: "failed",
    progress: 0,
    error:
      "ERROR: [youtube] aaaaaaaaaaa: Sign in to confirm you’re not a bot. Use " +
      "--cookies-from-browser or --cookies for the authentication.",
    file_id: null,
    created_at: "2026-08-20T22:25:13.000Z",
    started_at: "2026-08-20T22:25:13.000Z",
    finished_at: "2026-08-20T22:25:14.200Z",
    children: [],
  };

  it("keeps the error through parsing and turns it into room copy", () => {
    const parsed = downloadsResponseSchema.parse([wireJob]);

    expect(parsed[0]?.error).toContain("not a bot");
    expect(trackDownloadState(parsed, "aaaaaaaaaaa")).toEqual({
      kind: "failed",
      reason: "YouTube blocked this download",
    });
  });

  it("still parses when an older server omits the error field", () => {
    const { error: _error, ...withoutError } = wireJob;

    const parsed = downloadsResponseSchema.parse([withoutError]);

    expect(trackDownloadState(parsed, "aaaaaaaaaaa")).toEqual({
      kind: "failed",
      reason: "The download failed",
    });
  });

  it("carries live progress through for a running job", () => {
    const parsed = downloadsResponseSchema.parse([
      { ...wireJob, status: "running", progress: 63, error: null, finished_at: null },
    ]);

    expect(trackDownloadState(parsed, "aaaaaaaaaaa")).toEqual({ kind: "active", percent: 63 });
  });
});
