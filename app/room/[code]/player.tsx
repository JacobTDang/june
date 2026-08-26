"use client";

import { useEffect, useRef, useState } from "react";
import { Mic2, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { advanceTrack, markTrackReady } from "@/src/lib/room/actions";
import {
  PLAYBACK_MODE_STORAGE_KEY,
  readPlaybackMode,
  shouldPlayHere,
  type PlaybackMode,
} from "@/src/lib/room/playback-mode";
import { playbackCorrection } from "@/src/lib/room/sync";
import { VOLUME_STORAGE_KEY, readVolume, volumeLevel } from "@/src/lib/room/volume";
import type { QueueTrack, RoomNowPlaying } from "@/src/lib/room/types";
import { createAudioServer, type AudioServer } from "@/src/audio/client";
import { shouldSkipPreparing } from "@/src/audio/preparing";
import { trackDownloadState, type TrackDownloadState } from "@/src/audio/downloads";
import { createClient } from "@/src/lib/supabase/client";
import { Lyrics } from "./lyrics";
import { AlbumArt } from "./album-art";

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
  | { kind: "preparing"; percent: number | null }
  | { kind: "playing" }
  | { kind: "failed"; title: string; reason: string }
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
      return "Preparing this track…";
    case "preparing":
      // The percent is the download's own, straight off the job. Without it
      // a track that is genuinely downloading and one whose job died look
      // identical from the sofa.
      return status.percent === null
        ? "Preparing this track…"
        : `Downloading… ${status.percent}%`;
    case "failed":
      return `${status.reason} — skipping “${status.title}”.`;
    case "unreachable":
      return "Can’t reach the audio server — retrying…";
    case "config-error":
      return "Audio server isn’t configured.";
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
  // Per-device, so a second screen can follow the jam without doubling the
  // sound. Read from storage after mount: the server can't know this device's
  // choice, and rendering it during SSR would mismatch on hydration.
  const [mode, setMode] = useState<PlaybackMode>("play");
  // Also per device, and read in the same pass.
  const [volume, setVolume] = useState(1);
  useEffect(() => {
    try {
      setMode(readPlaybackMode(window.localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)));
      setVolume(readVolume(window.localStorage.getItem(VOLUME_STORAGE_KEY)));
    } catch {
      // Storage unavailable — stay on the defaults: play, full volume.
    }
  }, []);

  // The element carries its own volume across source changes, so this only
  // has to apply a change: the level restored from storage after mount, or a
  // drag of the slider.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  const [showLyrics, setShowLyrics] = useState(false);
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
    // Following along silently: hold no source at all rather than a paused
    // one, so this device neither streams bytes nor claims the media session.
    // Note the boundary this draws: readiness (markTrackReady, below) is
    // confirmed by a device that is actually loading the track, so a room
    // where *every* device is silent parks on a pending track until someone
    // switches their sound back on — at which point this effect re-runs and
    // the jam starts. Nobody listening, nothing playing.
    if (!shouldPlayHere(mode, started, np !== null)) {
      audio.pause();
      audio.removeAttribute("src");
      currentVideo.current = null;
      setStatus({ kind: "idle" });
      return;
    }
    if (!np || trackKey === null) {
      audio.pause();
      audio.removeAttribute("src");
      currentVideo.current = null;
      setStatus({ kind: "idle" });
      return;
    }

    if (currentVideo.current !== np.videoId) reminted.current = false;
    currentVideo.current = np.videoId;
    let preparingSince: number | null = null;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    async function load() {
      setStatus({ kind: "loading" });
      while (!cancelled) {
        let url: string | null;
        let download: TrackDownloadState = { kind: "idle" };
        try {
          url = await audioServer().mintStreamUrl(np!.videoId);
          if (url === null) {
            if (!ensured.current.has(np!.videoId)) {
              // Only a confirmed "queued" marks the id ensured — a throttled
              // request enqueued nothing, so the next poll must ask again.
              if ((await audioServer().ensureDownload(np!.videoId)) === "queued") {
                ensured.current.add(np!.videoId);
              }
            }
            // Only while actually waiting, and inside this try on purpose: if
            // the server can't answer, that's the "unreachable" path below,
            // not something to swallow and narrate as progress.
            download = trackDownloadState(
              await audioServer().listDownloads(),
              np!.videoId,
            );
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
          // Start the preparing clock at the first confirmed "not stored
          // yet" — server outage time must not eat the 90s budget.
          preparingSince ??= Date.now();
          if (download.kind === "failed") {
            // The job is already dead. Waiting out the remaining liveness
            // budget would tell the room nothing it doesn't now know.
            setStatus({ kind: "failed", title: np!.title, reason: download.reason });
            void advanceTrack(roomId, np!.videoId);
            return;
          }
          if (shouldSkipPreparing(preparingSince, Date.now())) {
            setStatus({ kind: "skipped", title: np!.title });
            void advanceTrack(roomId, np!.videoId);
            return;
          }
          setStatus({
            kind: "preparing",
            percent: download.kind === "active" ? download.percent : null,
          });
          await sleep(PREPARING_POLL_MS);
          continue;
        }

        if (np!.startedAt === null) {
          // Downloadable, but the room's clock hasn't started yet. Bounded by
          // the same 90s liveness clock as the download wait above - stamped
          // lazily (not at effect entry) so unreachable-server retry time
          // doesn't eat the budget before a wait state is actually observed.
          preparingSince ??= Date.now();
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
          setStatus({ kind: "preparing", percent: null });
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
  }, [started, trackKey, roomId, mode]);

  // Drift correction + end-of-track fallback, same policy as before.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      const audio = audioRef.current;
      const np = nowPlayingRef.current;
      if (!np || np.startedAt === null) return;
      const expectedSeconds = (Date.now() + offsetRef.current - np.startedAt) / 1000;

      // Following silently: there's no element to correct, but the track
      // still has to end. Without this, a room where every device chose
      // "listen in" would sit on a finished track forever, since the advance
      // normally rides on the playing device's clock check.
      if (mode === "silent") {
        const action = playbackCorrection({
          expectedSeconds,
          actualSeconds: expectedSeconds,
          durationMs: np.durationMs,
          driftThresholdSeconds: DRIFT_THRESHOLD_S,
        });
        if (action.kind === "advance") void advanceTrack(roomId, np.videoId);
        return;
      }

      if (!audio) return;
      if (currentVideo.current !== np.videoId || !audio.src) return;
      // Respect a local pause (e.g. from the lock screen); the next tick
      // after resuming re-seeks to the shared clock.
      if (audio.paused) return;
      // Seeking media that hasn't loaded metadata aborts and restarts its
      // fetch — on a 2s cadence that livelocks the load forever. Wait for
      // metadata before correcting drift.
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
      const action = playbackCorrection({
        expectedSeconds,
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
  }, [started, roomId, mode]);

  // Lock-screen metadata + controls. Not claimed while following silently:
  // this device isn't the one making sound, so it has no business owning the
  // lock screen or the headphone buttons.
  useEffect(() => {
    if (mode === "silent" || !started || !nowPlaying || !("mediaSession" in navigator)) return;
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
  }, [started, nowPlaying, mode]);

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
    // Tapping in is a request for sound: a device that was left muted would
    // otherwise take the tap and then sit there silent.
    if (mode === "silent") {
      setMode("play");
      try {
        window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, "play");
      } catch {
        // Storage unavailable; the choice still applies to this session.
      }
    }
    const audio = audioRef.current;
    if (audio) {
      audio.src = SILENCE;
      // Unlock inside the gesture; the rejection (if any) is irrelevant
      // because the loader immediately replaces the source.
      void audio.play().catch(() => {});
    }
    setStarted(true);
  }

  function changeVolume(next: number) {
    setVolume(next);
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable: the level still applies to this session.
    }
    // Turning the slider up on a muted device means "let me hear it" — the
    // drag is itself the gesture browsers need, so unmute rather than making
    // them find the button too.
    if (next > 0 && mode === "silent") togglePlayback();
  }

  /** Mute or unmute this device. Muting drops the source entirely rather than
   *  playing to nobody: the room stays in sync from the shared clock, so
   *  unmuting seeks straight back to where everyone else is. Unmuting is
   *  itself the user gesture browsers require, so it can unlock and start in
   *  one step rather than re-showing the tap gate. */
  function togglePlayback() {
    const next: PlaybackMode = mode === "play" ? "silent" : "play";
    setMode(next);
    try {
      window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). The
      // choice still applies to this session; it just won't be remembered.
    }
    if (next === "play" && !started) start();
  }

  const silent = mode === "silent";
  const level = volumeLevel(volume);

  return (
    <>
      <div className="audio-stage">
      <AlbumArt artworkUrl={nowPlaying?.thumbnailUrl ?? null} title={nowPlaying?.title ?? null} />
      </div>
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        playsInline
        onEnded={onEnded}
        onError={onError}
        onPlay={syncPlaybackState}
        onPause={syncPlaybackState}
      />
      <div className="stage__controls">
        {nowPlaying === null && (
          <div className="empty">
            <div className="empty__title">Your room is ready.</div>
            <p className="muted" style={{ marginTop: "var(--space-3)" }}>
              Add the first song. It starts playing for everyone at once.
            </p>
          </div>
        )}
        {showLyrics && nowPlaying !== null && (
          <Lyrics nowPlaying={nowPlaying} offset={offset} audioRef={audioRef} silent={silent} />
        )}
        {status.kind === "preparing" && status.percent !== null && (
          <div
            className="audio-stage__progress"
            role="progressbar"
            aria-label="Download progress"
            aria-valuenow={status.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="audio-stage__progress__fill"
              style={{ width: `${status.percent}%` }}
            />
          </div>
        )}
        {!started ? (
          <>
            <button onClick={start} className="btn btn--primary btn--lg">
              <Play size={17} fill="currentColor" strokeWidth={0} />
              Tap to listen in
            </button>
            {autoplayBlocked && (
              <p className="audio-stage__notice">Your browser paused autoplay. Tap again to join.</p>
            )}
          </>
        ) : (
          <p className="muted audio-stage__status">
            {nowPlaying !== null ? statusText(status) : ""}
          </p>
        )}
      </div>

      {/* Under the card, ahead of the track meta and the chat. Button first,
          slider after: the row is left-aligned, so the slider opens rightwards
          into empty space and the button stays where the cursor found it. */}
      <div className="sound">
        <button
          className="sound__btn"
          onClick={togglePlayback}
          title={silent ? "Unmute this device" : "Mute this device"}
          aria-label={silent ? "Unmute this device" : "Mute this device"}
          aria-pressed={silent}
        >
          {silent || level === "off" ? (
            <VolumeX size={15} />
          ) : level === "low" ? (
            <Volume1 size={15} />
          ) : (
            <Volume2 size={15} />
          )}
        </button>
        <input
          className="sound__slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Volume"
        />
        {/* Pinned to the right of the row (margin-left: auto), so the slider
            opening beside the speaker doesn't shift it. */}
        <button
          className="sound__lyrics"
          onClick={() => setShowLyrics((on) => !on)}
          aria-pressed={showLyrics}
          title={showLyrics ? "Hide lyrics" : "Show lyrics"}
        >
          <Mic2 size={14} />
          Lyrics
          <span className="sound__beta">beta</span>
        </button>
      </div>
    </>
  );
}
