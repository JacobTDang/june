"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { advanceTrack, markTrackReady } from "@/src/lib/room/actions";
import { playbackCorrection } from "@/src/lib/room/sync";
import type { QueueTrack, RoomNowPlaying } from "@/src/lib/room/types";
import { createAudioServer, type AudioServer } from "@/src/audio/client";
import { shouldSkipPreparing } from "@/src/audio/preparing";
import { createClient } from "@/src/lib/supabase/client";
import { PixelVisualizer, type VisualizerMode } from "./pixel-visualizer";

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
  | { kind: "config-error" }
  | { kind: "skipped"; title: string };

/** The exact message `audioServer()` throws when the env var is missing - a
 *  config error must not masquerade as a network blip (see statusText). */
const MISSING_CONFIG_MESSAGE = "NEXT_PUBLIC_MP3SERVER_URL is not configured.";

let cachedServer: AudioServer | null = null;
function audioServer(): AudioServer {
  if (!cachedServer) {
    const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
    if (!baseUrl) throw new Error(MISSING_CONFIG_MESSAGE);
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
    case "playing":
      // Idle's "Nothing playing." is replaced by the empty-state copy
      // (Feature B); playing shows no caption at all.
      return "";
    case "loading":
    case "preparing":
      return "Preparing this track…";
    case "unreachable":
      return "Can’t reach the audio server — retrying…";
    case "config-error":
      return "Audio server isn’t configured.";
    case "skipped":
      return `Couldn’t prepare “${status.title}” — skipping.`;
  }
}

function visualizerMode(status: Status): VisualizerMode {
  switch (status.kind) {
    case "playing":
      return "reactive";
    case "loading":
    case "preparing":
    case "unreachable":
      return "pulse";
    default:
      return "idle";
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
  // Set when the loader's NotAllowedError path re-offers the tap gate;
  // cleared on the next start() so it doesn't linger past a fresh attempt.
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  offsetRef.current = offset;
  nowPlayingRef.current = nowPlaying;

  // Primitive key so realtime refreshes (new object, same track) don't
  // cancel and restart an in-flight load. Folds in the pending/started state
  // so the effect re-runs the moment the shared clock starts (startedAt
  // flips from null to a number).
  const trackKey = nowPlaying
    ? `${nowPlaying.videoId}:${reloadNonce}:${nowPlaying.startedAt ?? "pending"}`
    : null;

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
    // Starts now so the download wait and the not-yet-started-clock wait
    // below share one 90s liveness bound from the moment this track becomes
    // current - no room state (downloading or pending) is left unbounded.
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
            // Only a confirmed "queued" marks the id ensured — a throttled
            // request enqueued nothing, so the next poll must ask again.
            if ((await audioServer().ensureDownload(np!.videoId)) === "queued") {
              ensured.current.add(np!.videoId);
            }
          }
        } catch (err) {
          if (cancelled) return;
          if (err instanceof Error && err.message === MISSING_CONFIG_MESSAGE) {
            // A config error can't self-heal by retrying - don't masquerade
            // it as a network blip, and don't loop forever re-throwing it.
            setStatus({ kind: "config-error" });
            return;
          }
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

        if (np!.startedAt === null) {
          // Downloadable, but the room's clock hasn't started yet. Bounded
          // by the same 90s liveness clock as the download wait above.
          if (shouldSkipPreparing(preparingSince, Date.now())) {
            setStatus({ kind: "skipped", title: np!.title });
            void advanceTrack(roomId, np!.videoId);
            return;
          }
          try {
            // Idempotent via CAS - fine if another listener already did.
            await markTrackReady(roomId, np!.videoId);
          } catch {
            if (cancelled) return;
            setStatus({ kind: "unreachable" });
            await sleep(UNREACHABLE_RETRY_MS);
            continue;
          }
          if (cancelled) return;
          // The realtime update flips startedAt, trackKey changes, and this
          // effect re-runs to mint again (server-cached, cheap) and actually
          // play. Do not set src/play yet.
          setStatus({ kind: "preparing" });
          return;
        }

        const el = audioRef.current;
        if (!el || cancelled) return;
        el.src = url;
        // Seek only once metadata is in: a seek before then aborts the
        // media fetch (see the drift-loop guard). Recompute the position at
        // metadata time so the wait itself doesn't add drift.
        el.addEventListener(
          "loadedmetadata",
          () => {
            const current = nowPlayingRef.current;
            if (!current || current.videoId !== np!.videoId || current.startedAt === null) {
              return;
            }
            el.currentTime = Math.max(
              0,
              (Date.now() + offsetRef.current - current.startedAt) / 1000,
            );
          },
          { once: true },
        );
        try {
          await el.play();
        } catch (err) {
          if (cancelled) return;
          if (err instanceof DOMException && err.name === "NotAllowedError") {
            // Autoplay was blocked after all — re-offer the tap gate rather
            // than claiming to play.
            setStarted(false);
            setStatus({ kind: "idle" });
            setAutoplayBlocked(true);
            return;
          }
          // Any other rejection is a source failure, which also fires the
          // element's onError — the re-mint path there takes over.
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
      if (!audio || !np || np.startedAt === null) return;
      if (currentVideo.current !== np.videoId || !audio.src) return;
      // Respect a local pause (e.g. from the lock screen); the next tick
      // after resuming re-seeks to the shared clock.
      if (audio.paused) return;
      // Seeking media that hasn't loaded metadata aborts and restarts its
      // fetch — on a 2s cadence that livelocks the load forever. Wait for
      // metadata before correcting drift.
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
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
    // Re-sync from the element's actual state: otherwise the previous
    // cleanup's "none" sticks across a realtime refresh (new nowPlaying
    // object, same track) until the next play/pause event fires.
    syncPlaybackState();
    return () => {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.playbackState = "none";
    };
  }, [started, nowPlaying]);

  // Pre-download upcoming tracks so they're ready when the room reaches them.
  // Best effort by design (see the spec): a failure here surfaces later as a
  // brief "Preparing" via the loader's self-heal, so it is not reported.
  useEffect(() => {
    if (!started) return;
    for (const track of upNext.slice(0, PREFETCH_COUNT)) {
      if (ensured.current.has(track.videoId)) continue;
      void (async () => {
        const url = await audioServer().mintStreamUrl(track.videoId);
        if (
          url !== null ||
          (await audioServer().ensureDownload(track.videoId)) === "queued"
        ) {
          ensured.current.add(track.videoId);
        }
      })().catch(() => {
        // Best effort by design (see the spec): the loader's play-time
        // self-heal covers anything prefetch misses, and it reports errors.
      });
    }
  }, [started, upNext]);

  function syncPlaybackState() {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = audioRef.current?.paused
        ? "paused"
        : "playing";
    }
  }

  function isUnlockClip(): boolean {
    return audioRef.current?.currentSrc.startsWith("data:") ?? false;
  }

  function onEnded() {
    // The zero-length unlock clip ends instantly — it must not advance the room.
    if (isUnlockClip()) return;
    if (currentVideo.current) void advanceTrack(roomId, currentVideo.current);
  }

  function onError() {
    // The unlock clip erroring must not burn the track's one re-mint.
    if (isUnlockClip()) return;
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
    setAutoplayBlocked(false);
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
      <PixelVisualizer audio={audioRef.current} mode={visualizerMode(status)} />
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        playsInline
        onEnded={onEnded}
        onError={onError}
        onPlay={syncPlaybackState}
        onPause={syncPlaybackState}
      />
      <div className="audio-stage__content">
        {nowPlaying === null && (
          <div className="empty">
            <div className="empty__title">Your room is ready.</div>
            <p className="muted" style={{ marginTop: "0.5rem" }}>
              Add the first song. It starts playing for everyone at once.
            </p>
          </div>
        )}
        {!started ? (
          <>
            <button onClick={start} className="btn btn--primary btn--lg">
              <Play size={17} fill="currentColor" strokeWidth={0} />
              Tap to listen in
            </button>
            {autoplayBlocked && (
              <p className="audio-stage__notice">
                Your browser paused autoplay — tap again to join.
              </p>
            )}
          </>
        ) : (
          nowPlaying !== null &&
          statusText(status) && (
            <p className="muted audio-stage__status">{statusText(status)}</p>
          )
        )}
      </div>
    </div>
  );
}
