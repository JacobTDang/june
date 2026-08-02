# mp3server Audio Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace june's room YouTube IFrame with `<audio>` streams served by mp3server, synced to the existing shared clock, and deploy mp3server publicly with TLS.

**Architecture:** The browser talks to mp3server directly using the user's june Supabase session token (mp3server is reconfigured to verify june's project tokens, CORS-allowed). mp3server gains one endpoint that mints a signed stream URL from a videoId. The room player mints a link for the current track and plays it in an `<audio>` element driven by the existing `playbackCorrection` sync logic; if the track isn't stored yet it triggers the (idempotent) download and polls. Prefetch is player-driven: the player also ensure-downloads the next two queued tracks.

**Tech Stack:** june: Next.js 16 / React 19 / TypeScript / Zod / Vitest. mp3server (sibling repo at `../mp3server`): FastAPI / SQLAlchemy / pytest. Deploy: Docker Compose + Caddy on Oracle Always Free (arm64).

**Spec:** `docs/superpowers/specs/2026-08-02-mp3server-playback-design.md`

## Global Constraints

- TDD: failing test first, then implementation, for every code change with testable logic.
- Fail loud: no swallowed errors. The two deliberate best-effort paths (prefetch, unlock-play) each carry a comment explaining why and what surfaces the failure instead.
- No new dependencies in either repo. Zod and Vitest already exist in june; pytest already exists in mp3server.
- Commit messages: plain imperative ("Add X"), no tool attribution of any kind, no Co-Authored-By lines.
- june work happens on branch `mp3server-playback`; mp3server work on branch `by-video-link` in `/Users/jacobdang/Desktop/projects/mp3server`.
- Repos: june = `/Users/jacobdang/Desktop/projects/june`, mp3server = `/Users/jacobdang/Desktop/projects/mp3server`.
- june's Supabase project ref: `ksqjgsezfqfevnfvonnm` (`https://ksqjgsezfqfevnfvonnm.supabase.co`).

---

### Task 1: mp3server — mint a stream link by videoId

**Files:**
- Modify: `/Users/jacobdang/Desktop/projects/mp3server/src/mp3server/routes/files.py`
- Test: `/Users/jacobdang/Desktop/projects/mp3server/tests/test_api_files.py`

**Interfaces:**
- Consumes: existing `File` model, `links.sign`, `get_current_user_id`, `Settings.download_link_secret/download_link_ttl_seconds`.
- Produces: `POST /files/by-video/{video_id}/link` → `{"url": "/files/<file-uuid>/stream?exp=…&sig=…", "expires_at": <int>}`; `404` when no file row has that `video_id`; `401` unauthenticated; `503` when `DOWNLOAD_LINK_SECRET` unset. Task 2's client calls this.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && git checkout -b by-video-link
```

- [ ] **Step 2: Write the failing tests** — append to `tests/test_api_files.py`:

```python
async def test_link_by_video_404_when_absent(client, authed):
    resp = await client.post("/files/by-video/vid-none/link")
    assert resp.status_code == 404


async def test_link_by_video_requires_auth(client, stored_file):
    resp = await client.post("/files/by-video/vid1/link")
    assert resp.status_code == 401


async def test_link_by_video_mints_for_a_track_another_user_stored(
    client, authed, db, app, tmp_path
):
    """Room listeners must be able to play a track someone else queued."""
    src = tmp_path / "other.mp3"
    src.write_bytes(b"their-data")
    await app.state.storage.save(src, "vid9.m4a")
    theirs = File(
        user_id=uuid.uuid4(), video_id="vid9", title="Theirs", uploader=None,
        duration_seconds=90, filesize_bytes=10, storage_backend="local",
        storage_key="vid9.m4a",
    )
    db.add(theirs)
    await db.commit()

    minted = await client.post("/files/by-video/vid9/link")
    assert minted.status_code == 200
    url = minted.json()["url"]

    client.headers.pop("authorization", None)
    resp = await client.get(url)
    assert resp.status_code == 200
    assert resp.content == b"their-data"


async def test_link_by_video_picks_the_newest_row(client, authed, db):
    """Two users can each hold a row for the same video; resolve to the newest."""
    old = File(
        user_id=uuid.uuid4(), video_id="vid2", title="Old", uploader=None,
        duration_seconds=90, filesize_bytes=8, storage_backend="local",
        storage_key="vid2.m4a", created_at=datetime(2026, 1, 1),
    )
    new = File(
        user_id=uuid.uuid4(), video_id="vid2", title="New", uploader=None,
        duration_seconds=90, filesize_bytes=8, storage_backend="local",
        storage_key="vid2.m4a", created_at=datetime(2026, 6, 1),
    )
    db.add_all([old, new])
    await db.commit()

    minted = await client.post("/files/by-video/vid2/link")
    assert minted.status_code == 200
    assert str(new.id) in minted.json()["url"]
```

Add the import at the top of the file (it already imports `uuid` and `File`):

```python
from datetime import datetime
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && .venv/bin/pytest tests/test_api_files.py -v
```

Expected: the three new non-404 tests FAIL (the mint tests get 404 because the route doesn't exist; the auth test gets 404 instead of 401). `test_link_by_video_404_when_absent` passes vacuously today (unknown route also 404s) — it becomes meaningful once the route exists. All pre-existing tests still pass.

- [ ] **Step 4: Implement the endpoint** — in `src/mp3server/routes/files.py`, refactor the mint logic out of `create_download_link` and add the new route. Replace the body of `create_download_link` and add the two helpers plus the new endpoint directly below it:

```python
def _require_link_secret(settings: Settings) -> None:
    if not settings.download_link_secret:
        raise HTTPException(
            status_code=503,
            detail="signed links are unavailable: DOWNLOAD_LINK_SECRET is not set",
        )


def _signed_link(record: File, settings: Settings) -> dict:
    expires_at = int(time.time()) + settings.download_link_ttl_seconds
    signature = links.sign(str(record.id), expires_at, settings.download_link_secret)
    return {
        "url": f"/files/{record.id}/stream?exp={expires_at}&sig={signature}",
        "expires_at": expires_at,
    }
```

`create_download_link` keeps its docstring and signature; its body becomes:

```python
    _require_link_secret(settings)
    record = await db.scalar(select(File).where(File.id == file_id))
    if record is None:
        raise HTTPException(status_code=404, detail="file not found")
    return _signed_link(record, settings)
```

New endpoint (place after `create_download_link`; the path has three segments so it cannot collide with `/files/{file_id}/link`):

```python
@router.post("/by-video/{video_id}/link")
async def create_link_by_video_id(
    video_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    """Mint a stream link from a video id.

    Room clients know the videoId of the shared track, not which user's file
    row holds it. Same cross-user semantics as /files/{id}/link: any invited
    user may resolve any stored video.
    """
    _require_link_secret(settings)
    record = await db.scalar(
        select(File)
        .where(File.video_id == video_id)
        .order_by(File.created_at.desc(), File.id.desc())
        .limit(1)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="no stored file for that video")
    return _signed_link(record, settings)
```

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && .venv/bin/pytest -v
```

Expected: ALL pass (including the four new tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && git add src/mp3server/routes/files.py tests/test_api_files.py && git commit -m "Add POST /files/by-video/{video_id}/link"
```

---

### Task 2: june — `src/audio/` mp3server client + preparing policy

**Files:**
- Create: `/Users/jacobdang/Desktop/projects/june/src/audio/schema.ts`
- Create: `/Users/jacobdang/Desktop/projects/june/src/audio/client.ts`
- Create: `/Users/jacobdang/Desktop/projects/june/src/audio/preparing.ts`
- Test: `/Users/jacobdang/Desktop/projects/june/test/audio/client.test.ts`
- Test: `/Users/jacobdang/Desktop/projects/june/test/audio/preparing.test.ts`

**Interfaces:**
- Consumes: Task 1's endpoint; mp3server's existing `POST /downloads` (202 on accept, 429 on the per-user pending cap).
- Produces (Task 3 relies on these exact names):
  - `createAudioServer(config: AudioServerConfig): AudioServer` from `src/audio/client.ts`
  - `AudioServer.mintStreamUrl(videoId: string): Promise<string | null>` — absolute URL, `null` when the track isn't stored yet (404); throws on any other failure.
  - `AudioServer.ensureDownload(videoId: string): Promise<"queued" | "throttled">` — `"throttled"` on 429; throws on any other failure.
  - `AudioServerConfig = { baseUrl: string; getAccessToken: () => Promise<string | null>; fetch?: FetchLike }`
  - `shouldSkipPreparing(preparingSinceMs: number, nowMs: number): boolean` and `PREPARING_TIMEOUT_MS = 90_000` from `src/audio/preparing.ts`.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/jacobdang/Desktop/projects/june && git checkout -b mp3server-playback
```

- [ ] **Step 2: Write the failing client tests** — create `test/audio/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAudioServer } from "../../src/audio/client";

/** A fetch stub that records requested URLs + init, and replies per handler. */
function stubFetch(handler: (url: URL) => { status?: number; body?: unknown }) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const token = async () => "tok";

describe("mintStreamUrl", () => {
  it("mints an absolute stream URL with the bearer token", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { url: "/files/abc/stream?exp=1&sig=s", expires_at: 1 },
    }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    const url = await server.mintStreamUrl("vid1");

    expect(url).toBe("https://audio.test/files/abc/stream?exp=1&sig=s");
    expect(calls[0]!.url.toString()).toBe("https://audio.test/files/by-video/vid1/link");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("returns null when the track is not stored yet", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { detail: "no stored file" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.mintStreamUrl("vid1")).toBeNull();
  });

  it("throws on any other error status", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { detail: "no secret" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await expect(server.mintStreamUrl("vid1")).rejects.toThrow("audio server 503: no secret");
  });

  it("throws when there is no session", async () => {
    const { fetch } = stubFetch(() => ({ body: {} }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: async () => null,
      fetch,
    });

    await expect(server.mintStreamUrl("vid1")).rejects.toThrow("not signed in");
  });
});

describe("ensureDownload", () => {
  it("posts the watch URL and reports queued", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 202, body: { id: "j", status: "queued" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.ensureDownload("vid1")).toBe("queued");
    expect(calls[0]!.url.toString()).toBe("https://audio.test/downloads");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      url: "https://www.youtube.com/watch?v=vid1",
    });
  });

  it("reports throttled when the pending cap is hit", async () => {
    const { fetch } = stubFetch(() => ({ status: 429, body: { detail: "too many pending" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.ensureDownload("vid1")).toBe("throttled");
  });

  it("throws on any other error status", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { detail: "queue unavailable" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await expect(server.ensureDownload("vid1")).rejects.toThrow(
      "audio server 503: queue unavailable",
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /Users/jacobdang/Desktop/projects/june && npx vitest run test/audio/client.test.ts
```

Expected: FAIL — cannot resolve `../../src/audio/client`.

- [ ] **Step 4: Implement schema and client** — create `src/audio/schema.ts`:

```ts
import { z } from "zod";

/** Response of mp3server's POST /files/by-video/{videoId}/link. */
export const linkResponseSchema = z.object({
  url: z.string().startsWith("/"),
  expires_at: z.number(),
});
```

Create `src/audio/client.ts`:

```ts
import { linkResponseSchema } from "./schema";

/** The one bit of `fetch` we use - injectable so tests need no network. */
type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

/** The slice of mp3server the room player needs. */
export interface AudioServer {
  /** Absolute stream URL for a stored track, or null when it isn't stored yet. */
  mintStreamUrl(videoId: string): Promise<string | null>;
  /**
   * Ask the server to download a video. Idempotent: already-cached videos
   * complete near-instantly server-side. "throttled" = the per-user pending
   * cap; the caller's play-time polling covers the track regardless.
   */
  ensureDownload(videoId: string): Promise<"queued" | "throttled">;
}

export interface AudioServerConfig {
  /** e.g. https://audio.example.com — trailing slash tolerated. */
  baseUrl: string;
  /** The user's Supabase access token; null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

export function createAudioServer(config: AudioServerConfig): AudioServer {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  async function post(path: string, body?: unknown): Promise<Response> {
    const accessToken = await config.getAccessToken();
    if (accessToken === null) throw new Error("audio server: not signed in");
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    const init: RequestInit = { method: "POST", headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return doFetch(new URL(`${baseUrl}${path}`), init);
  }

  return {
    async mintStreamUrl(videoId) {
      const response = await post(`/files/by-video/${encodeURIComponent(videoId)}/link`);
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`audio server ${response.status}: ${await errorDetail(response)}`);
      }
      const { url } = linkResponseSchema.parse(await response.json());
      return `${baseUrl}${url}`;
    },

    async ensureDownload(videoId) {
      const response = await post("/downloads", {
        url: `https://www.youtube.com/watch?v=${videoId}`,
      });
      if (response.status === 429) return "throttled";
      if (!response.ok) {
        throw new Error(`audio server ${response.status}: ${await errorDetail(response)}`);
      }
      return "queued";
    },
  };
}
```

- [ ] **Step 5: Run client tests — expect PASS**

```bash
cd /Users/jacobdang/Desktop/projects/june && npx vitest run test/audio/client.test.ts
```

- [ ] **Step 6: Write the failing preparing-policy test** — create `test/audio/preparing.test.ts`:

```ts
import { expect, it } from "vitest";
import { PREPARING_TIMEOUT_MS, shouldSkipPreparing } from "../../src/audio/preparing";

it("waits while the download is younger than the timeout", () => {
  expect(shouldSkipPreparing(1_000, 1_000 + PREPARING_TIMEOUT_MS - 1)).toBe(false);
});

it("skips once the timeout elapses", () => {
  expect(shouldSkipPreparing(1_000, 1_000 + PREPARING_TIMEOUT_MS)).toBe(true);
});
```

- [ ] **Step 7: Run to verify failure, then implement** — create `src/audio/preparing.ts`:

```ts
/**
 * How long a room waits for a track download before skipping it. Long enough
 * for a normal yt_dlp run (~5-20s), short enough that a failed job doesn't
 * hold the room hostage for the track's whole duration.
 */
export const PREPARING_TIMEOUT_MS = 90_000;

export function shouldSkipPreparing(preparingSinceMs: number, nowMs: number): boolean {
  return nowMs - preparingSinceMs >= PREPARING_TIMEOUT_MS;
}
```

- [ ] **Step 8: Run the full june suite**

```bash
cd /Users/jacobdang/Desktop/projects/june && npm test
```

Expected: ALL pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/jacobdang/Desktop/projects/june && git add src/audio test/audio && git commit -m "Add mp3server audio client and preparing policy"
```

---

### Task 3: june — rewrite the room player around `<audio>`

**Files:**
- Modify: `/Users/jacobdang/Desktop/projects/june/app/room/[code]/player.tsx` (full rewrite)
- Modify: `/Users/jacobdang/Desktop/projects/june/app/room/[code]/room.tsx` (~line 305: pass `upNext`)
- Modify: `/Users/jacobdang/Desktop/projects/june/app/globals.css` (~lines 757–792: replace player CSS)

**Interfaces:**
- Consumes: `createAudioServer`, `shouldSkipPreparing` (Task 2, exact signatures above); existing `playbackCorrection` (`src/lib/room/sync.ts`), `advanceTrack(roomId, endedVideoId)` (`src/lib/room/actions.ts`), `createClient` (`src/lib/supabase/client.ts`), `RoomNowPlaying`/`QueueTrack` (`src/lib/room/types.ts`).
- Produces: `Player({ roomId, nowPlaying, offset, upNext })` — `upNext: QueueTrack[]` is new; `room.tsx` passes `queue.slice(0, 2)`.

- [ ] **Step 1: Rewrite `app/room/[code]/player.tsx`** with exactly:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { advanceTrack } from "@/src/lib/room/actions";
import { playbackCorrection } from "@/src/lib/room/sync";
import type { QueueTrack, RoomNowPlaying } from "@/src/lib/room/types";
import { createAudioServer, type AudioServer } from "@/src/audio/client";
import { shouldSkipPreparing } from "@/src/audio/preparing";
import { createClient } from "@/src/lib/supabase/client";

/** Re-seek if the local player drifts more than this from the shared clock. */
const DRIFT_THRESHOLD_S = 1.2;
/** How often to re-check the link while a track is still downloading. */
const PREPARING_POLL_MS = 3000;
/** How often to retry when mp3server is unreachable. */
const UNREACHABLE_RETRY_MS = 5000;
/** How many upcoming queue tracks to pre-download. */
const PREFETCH_COUNT = 2;

/**
 * One sample of silence. Played inside the tap gesture so iOS marks the
 * element user-activated; the real (asynchronously minted) src can then be
 * play()ed programmatically.
 */
const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "preparing" }
  | { kind: "playing" }
  | { kind: "unreachable" }
  | { kind: "skipped"; title: string };

let cachedServer: AudioServer | null = null;
function audioServer(): AudioServer {
  if (!cachedServer) {
    const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
    if (!baseUrl) throw new Error("NEXT_PUBLIC_MP3SERVER_URL is not configured.");
    const supabase = createClient();
    cachedServer = createAudioServer({
      baseUrl,
      getAccessToken: async () =>
        (await supabase.auth.getSession()).data.session?.access_token ?? null,
    });
  }
  return cachedServer;
}

function statusText(status: Status): string {
  switch (status.kind) {
    case "idle":
      return "Nothing playing.";
    case "loading":
      return "Tuning in…";
    case "preparing":
      return "Preparing this track…";
    case "playing":
      return "Listening in sync.";
    case "unreachable":
      return "Can’t reach the audio server — retrying…";
    case "skipped":
      return `Couldn’t prepare “${status.title}” — skipping.`;
  }
}

export function Player({
  roomId,
  nowPlaying,
  offset,
  upNext,
}: {
  roomId: string;
  nowPlaying: RoomNowPlaying | null;
  offset: number;
  upNext: QueueTrack[];
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const offsetRef = useRef(offset);
  const nowPlayingRef = useRef(nowPlaying);
  const currentVideo = useRef<string | null>(null);
  /** videoIds this session already asked the server to download. */
  const ensured = useRef(new Set<string>());
  /** Whether the current track already got its one link re-mint. */
  const reminted = useRef(false);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [reloadNonce, setReloadNonce] = useState(0);

  offsetRef.current = offset;
  nowPlayingRef.current = nowPlaying;

  // Primitive key so realtime refreshes (new object, same track) don't
  // cancel and restart an in-flight load.
  const trackKey = nowPlaying ? `${nowPlaying.videoId}:${reloadNonce}` : null;

  // Load the shared track: mint a stream link, or trigger the download and
  // poll until it exists. Cancelled (and restarted) when the track changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!started || !audio) return;
    const np = nowPlayingRef.current;
    if (!np || trackKey === null) {
      audio.pause();
      audio.removeAttribute("src");
      currentVideo.current = null;
      setStatus({ kind: "idle" });
      return;
    }

    if (currentVideo.current !== np.videoId) reminted.current = false;
    currentVideo.current = np.videoId;
    const preparingSince = Date.now();
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    async function load() {
      setStatus({ kind: "loading" });
      while (!cancelled) {
        let url: string | null;
        try {
          url = await audioServer().mintStreamUrl(np!.videoId);
          if (url === null && !ensured.current.has(np!.videoId)) {
            ensured.current.add(np!.videoId);
            try {
              await audioServer().ensureDownload(np!.videoId);
            } catch (err) {
              ensured.current.delete(np!.videoId); // retried on the next poll
              throw err;
            }
          }
        } catch {
          if (cancelled) return;
          setStatus({ kind: "unreachable" });
          await sleep(UNREACHABLE_RETRY_MS);
          continue;
        }
        if (cancelled) return;

        if (url === null) {
          if (shouldSkipPreparing(preparingSince, Date.now())) {
            setStatus({ kind: "skipped", title: np!.title });
            void advanceTrack(roomId, np!.videoId);
            return;
          }
          setStatus({ kind: "preparing" });
          await sleep(PREPARING_POLL_MS);
          continue;
        }

        const el = audioRef.current;
        if (!el || cancelled) return;
        el.src = url;
        el.currentTime = Math.max(
          0,
          (Date.now() + offsetRef.current - np!.startedAt) / 1000,
        );
        try {
          await el.play();
        } catch {
          // `started` already gates the autoplay gesture, so a rejection here
          // means the source itself failed — the element's onError re-mint
          // path takes over.
        }
        if (!cancelled) setStatus({ kind: "playing" });
        return;
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [started, trackKey, roomId]);

  // Drift correction + end-of-track fallback, same policy as before.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      const audio = audioRef.current;
      const np = nowPlayingRef.current;
      if (!audio || !np || currentVideo.current !== np.videoId || !audio.src) return;
      // Respect a local pause (e.g. from the lock screen); the next tick
      // after resuming re-seeks to the shared clock.
      if (audio.paused) return;
      const action = playbackCorrection({
        expectedSeconds: (Date.now() + offsetRef.current - np.startedAt) / 1000,
        actualSeconds: audio.currentTime,
        durationMs: np.durationMs,
        driftThresholdSeconds: DRIFT_THRESHOLD_S,
      });
      if (action.kind === "advance") {
        void advanceTrack(roomId, np.videoId);
        return;
      }
      if (action.kind === "seek") audio.currentTime = action.toSeconds;
    }, 2000);
    return () => clearInterval(id);
  }, [started, roomId]);

  // Lock-screen metadata + controls.
  useEffect(() => {
    if (!started || !nowPlaying || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: nowPlaying.title,
      artist: nowPlaying.artist ?? "",
      album: "june",
      artwork: nowPlaying.thumbnailUrl
        ? [{ src: nowPlaying.thumbnailUrl, sizes: "480x480" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
  }, [started, nowPlaying]);

  // Pre-download upcoming tracks so they're ready when the room reaches them.
  // Best effort by design (see the spec): a failure here surfaces later as a
  // brief "Preparing" via the loader's self-heal, so it is not reported.
  useEffect(() => {
    if (!started) return;
    for (const track of upNext.slice(0, PREFETCH_COUNT)) {
      if (ensured.current.has(track.videoId)) continue;
      ensured.current.add(track.videoId);
      void audioServer()
        .mintStreamUrl(track.videoId)
        .then((url) =>
          url === null ? audioServer().ensureDownload(track.videoId) : undefined,
        )
        .then(() => undefined)
        .catch(() => ensured.current.delete(track.videoId));
    }
  }, [started, upNext]);

  function syncPlaybackState() {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = audioRef.current?.paused
        ? "paused"
        : "playing";
    }
  }

  function onEnded() {
    if (currentVideo.current) void advanceTrack(roomId, currentVideo.current);
  }

  function onError() {
    // One re-mint per track: a signed link can expire mid-play. A second
    // failure means the source itself is broken — move the room along.
    if (reminted.current) {
      if (currentVideo.current) void advanceTrack(roomId, currentVideo.current);
      return;
    }
    reminted.current = true;
    setReloadNonce((n) => n + 1);
  }

  function start() {
    const audio = audioRef.current;
    if (audio) {
      audio.src = SILENCE;
      // Unlock inside the gesture; the rejection (if any) is irrelevant
      // because the loader immediately replaces the source.
      void audio.play().catch(() => {});
    }
    setStarted(true);
  }

  return (
    <div className="audio-stage">
      <audio
        ref={audioRef}
        playsInline
        onEnded={onEnded}
        onError={onError}
        onPlay={syncPlaybackState}
        onPause={syncPlaybackState}
      />
      {!started ? (
        <button onClick={start} className="btn btn--primary btn--lg">
          <Play size={17} fill="currentColor" strokeWidth={0} />
          Tap to listen in
        </button>
      ) : (
        <p className="muted audio-stage__status">{statusText(status)}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass the queue head from `room.tsx`** — at ~line 305, change:

```tsx
<Player roomId={initial.id} nowPlaying={nowPlaying} offset={offset} />
```

to:

```tsx
<Player
  roomId={initial.id}
  nowPlaying={nowPlaying}
  offset={offset}
  upNext={queue.slice(0, 2)}
/>
```

(`queue` is the existing local state at `room.tsx:100`.)

- [ ] **Step 3: Replace the player CSS** — in `app/globals.css`, replace the `.player-skeleton`, `.player-blocked`, `.player-blocked__title`, and `.player-blocked__body` rules (lines ~760–792; keep `.player-wrap`) with:

```css
.player-skeleton {
  min-height: 120px;
  border-radius: var(--r);
  background: var(--surface);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
}
.audio-stage {
  min-height: 120px;
  border-radius: var(--r);
  background: var(--surface);
  border: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 1.25rem;
  text-align: center;
}
.audio-stage__status {
  margin: 0;
  font-size: 0.85rem;
}
```

Then confirm nothing else references the removed classes:

```bash
cd /Users/jacobdang/Desktop/projects/june && grep -rn "player-blocked" app src
```

Expected: no matches.

- [ ] **Step 4: Typecheck and test**

```bash
cd /Users/jacobdang/Desktop/projects/june && npx tsc --noEmit && npm test
```

Expected: no type errors, all tests pass. (The repo has no eslint config; the dev-server run in Task 4 is the runtime check.)

- [ ] **Step 5: Commit**

```bash
cd /Users/jacobdang/Desktop/projects/june && git add "app/room/[code]/player.tsx" "app/room/[code]/room.tsx" app/globals.css && git commit -m "Play rooms through mp3server audio instead of the YouTube IFrame"
```

---

### Task 4: Local end-to-end — point local mp3server at june's Supabase and verify

No june code in this task; it wires environments and proves the whole loop works before deploying. `.env` files are not committed.

- [ ] **Step 1: Determine june's token signing algorithm**

```bash
curl -s https://ksqjgsezfqfevnfvonnm.supabase.co/auth/v1/.well-known/jwks.json
```

- If the response contains an `ES256` key: set `SUPABASE_URL=https://ksqjgsezfqfevnfvonnm.supabase.co` in `/Users/jacobdang/Desktop/projects/mp3server/.env` (and remove/comment the old `SUPABASE_JWT_SECRET`).
- If not: **[USER]** copy june project's JWT Secret (Supabase dashboard → Settings → API) into `SUPABASE_JWT_SECRET`.

- [ ] **Step 2: Configure local mp3server `.env`** — edit `/Users/jacobdang/Desktop/projects/mp3server/.env`, keeping the existing `DATABASE_URL` (mp3server keeps its own Postgres; only token *verification* moves to june's project) and adding/updating:

```
CORS_ALLOW_ORIGINS=http://localhost:3000
DOWNLOAD_LINK_SECRET=<output of: openssl rand -hex 32>
ALLOWED_USER_IDS=
```

- [ ] **Step 3: Start mp3server locally**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && docker compose up --build -d && sleep 15 && curl -s http://localhost:8000/readyz
```

Expected: `{"status":"ready",...}` with every dependency reporting ok. If 503, the body names whichever of Postgres/Redis is down — fix before continuing.

- [ ] **Step 4: Configure june dev env** — add to `/Users/jacobdang/Desktop/projects/june/.env.local`:

```
NEXT_PUBLIC_MP3SERVER_URL=http://localhost:8000
```

- [ ] **Step 5: Manual end-to-end verification**

1. `cd /Users/jacobdang/Desktop/projects/june && npm run dev`
2. Open `http://localhost:3000`, sign in, create a room, add a song.
3. Tap **Tap to listen in** — expect "Preparing this track…" for a few seconds on first play, then audio.
4. Open the room in a second browser (second account) — expect both browsers within ~1 second of each other.
5. Let a track end — expect auto-advance in both browsers.
6. DevTools network tab: confirm requests go to `localhost:8000` (`/files/by-video/...`, `/files/.../stream`) with 200s, and no requests to `youtube.com/iframe_api`.

Expected: all six observations hold. Fix anything that doesn't before moving on.

---

### Task 5: mp3server — Caddy TLS for production

**Files:**
- Create: `/Users/jacobdang/Desktop/projects/mp3server/Caddyfile`
- Modify: `/Users/jacobdang/Desktop/projects/mp3server/docker-compose.yml`
- Modify: `/Users/jacobdang/Desktop/projects/mp3server/.env.example`

**Interfaces:**
- Produces: `docker compose --profile prod up` serves the API at `https://$MP3SERVER_DOMAIN`; plain `docker compose up` (local dev) is unchanged.

- [ ] **Step 1: Create `Caddyfile`**

```
{$MP3SERVER_DOMAIN}

reverse_proxy api:8000
```

- [ ] **Step 2: Add the caddy service** — in `docker-compose.yml`, add under `services:` (after `redis`), reusing the existing `*logging` anchor:

```yaml
  # TLS terminator for production only: `docker compose --profile prod up`.
  # Local dev keeps hitting the api service on :8000 directly.
  caddy:
    image: caddy:2-alpine
    profiles: ["prod"]
    ports:
      - "80:80"
      - "443:443"
    environment:
      MP3SERVER_DOMAIN: ${MP3SERVER_DOMAIN:?set the public hostname in .env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddydata:/data
      - caddyconfig:/config
    depends_on:
      - api
    restart: unless-stopped
    logging: *logging
```

And extend the top-level `volumes:` block:

```yaml
volumes:
  mp3data:
  redisdata:
  caddydata:
  caddyconfig:
```

- [ ] **Step 3: Document in `.env.example`** — append:

```
# Public hostname for the prod TLS proxy (docker compose --profile prod up).
# Caddy auto-provisions the certificate for this domain.
# MP3SERVER_DOMAIN=audio.example.com
```

- [ ] **Step 4: Validate both profiles parse**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && docker compose config -q && MP3SERVER_DOMAIN=example.com docker compose --profile prod config -q && echo OK
```

Expected: `OK` (no output from the config checks).

- [ ] **Step 5: Run the mp3server test suite (unchanged code, sanity)**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && .venv/bin/pytest -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/jacobdang/Desktop/projects/mp3server && git add Caddyfile docker-compose.yml .env.example && git commit -m "Add prod-profile Caddy TLS terminator"
```

---

### Task 6: Deploy mp3server to Oracle Always Free

Ops task — steps marked **[USER]** need actions only the account owner can take. Everything else is exact commands to run on the box over ssh.

- [ ] **Step 1 [USER]: Provision**
  - Create an Always Free ARM instance: VM.Standard.A1.Flex (suggest 2 OCPU / 12GB, still free), Ubuntu 22.04+.
  - VCN security list: allow ingress TCP 80 and 443 only (not 8000).
  - Pick a subdomain (e.g. `audio.<your-domain>`) and create a DNS A record pointing at the instance's public IP.
  - Export youtube.com cookies with a "Get cookies.txt LOCALLY"-style extension (Netscape format).

- [ ] **Step 2: Install and clone (on the box)**

```bash
curl -fsSL https://get.docker.com | sh
git clone <mp3server repo remote> mp3server && cd mp3server
git checkout by-video-link   # until the branch is merged, then main
cp .env.example .env
```

- [ ] **Step 3: Fill `/home/ubuntu/mp3server/.env`** — same values as Task 4's local config, plus prod specifics:

```
DATABASE_URL=<mp3server's existing Supabase pooler URL, unchanged>
SUPABASE_URL=https://ksqjgsezfqfevnfvonnm.supabase.co   # or SUPABASE_JWT_SECRET per Task 4 Step 1
ALLOWED_USER_IDS=
CORS_ALLOW_ORIGINS=https://<june-prod-domain>,http://localhost:3000
DOWNLOAD_LINK_SECRET=<openssl rand -hex 32>
COOKIES_FILE=/config/cookies.txt
MP3SERVER_DOMAIN=<the subdomain from Step 1>
```

- [ ] **Step 4: Mount cookies** — copy the exported `cookies.txt` to the repo root on the box (`scp cookies.txt ubuntu@<ip>:mp3server/`), then create `docker-compose.override.yml` (box-only, not committed):

```yaml
services:
  worker:
    volumes:
      - ./cookies.txt:/config/cookies.txt:ro
```

- [ ] **Step 5: Migrate and start**

```bash
cd ~/mp3server
docker compose run --rm api alembic upgrade head
docker compose --profile prod up -d --build
```

- [ ] **Step 6: Smoke test from your laptop**

```bash
curl -s https://<subdomain>/healthz && curl -s https://<subdomain>/readyz
```

Expected: both 200 over valid TLS. Then the real test: in a june room served from `npm run dev` with `.env.local` temporarily pointing `NEXT_PUBLIC_MP3SERVER_URL=https://<subdomain>`, add a fresh track and confirm it prepares and plays (this proves cookies + yt_dlp work from the datacenter IP). Revert `.env.local` to `http://localhost:8000` afterward if you prefer local downloads during dev.

---

### Task 7: Wire june production and open PRs

- [ ] **Step 1 [USER-adjacent]: Vercel env** — add `NEXT_PUBLIC_MP3SERVER_URL=https://<subdomain>` to the Vercel project (Production + Preview). Via CLI if logged in:

```bash
cd /Users/jacobdang/Desktop/projects/june && npx vercel env add NEXT_PUBLIC_MP3SERVER_URL production
```

- [ ] **Step 2: Push branches and open PRs**

```bash
cd /Users/jacobdang/Desktop/projects/june && git push -u origin mp3server-playback && gh pr create --title "Play rooms through mp3server audio" --body "<what changed and why — see spec docs/superpowers/specs/2026-08-02-mp3server-playback-design.md>"
cd /Users/jacobdang/Desktop/projects/mp3server && git push -u origin by-video-link && gh pr create --title "Add by-video link endpoint and prod TLS profile" --body "<what changed and why>"
```

PR descriptions cover what changed and why only. Include a short screen recording of two synced browsers if feasible; delete the media afterward.

- [ ] **Step 3: After merge + Vercel deploy — prod smoke test**

1. Open the prod site on a phone, join a room, tap to listen.
2. Lock the phone: audio keeps playing, lock screen shows title/artist.
3. Second device in the same room stays within ~1s.

Expected: all three hold. This is the acceptance test for the feature's original motivation.
