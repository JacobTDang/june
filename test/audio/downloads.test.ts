import { describe, expect, it } from "vitest";
import { activeDownloadProgress, type DownloadJob } from "../../src/audio/downloads";

function job(overrides: Partial<DownloadJob>): DownloadJob {
  return {
    id: "j1",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    status: "running",
    progress: 0,
    ...overrides,
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
