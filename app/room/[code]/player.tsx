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
