"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { advanceTrack } from "@/src/lib/room/actions";
import { playbackCorrection } from "@/src/lib/room/sync";
import type { RoomNowPlaying } from "@/src/lib/room/types";

/** Re-seek if the local player drifts more than this from the shared clock. */
const DRIFT_THRESHOLD_S = 1.2;
const YT_STATE_ENDED = 0;

interface YTPlayerEvent {
  data: number;
}
interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
}
interface YTPlayerOptions {
  width?: string;
  height?: string;
  host?: string;
  playerVars?: Record<string, unknown>;
  events?: {
    onReady?: () => void;
    onStateChange?: (e: YTPlayerEvent) => void;
    onError?: (e: YTPlayerEvent) => void;
  };
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.getElementById("youtube-iframe-api")) {
      const tag = document.createElement("script");
      tag.id = "youtube-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      // Ad blockers that drop this request fire onerror — surface it, don't hang.
      tag.onerror = () => reject(new Error("YouTube API failed to load"));
      document.body.appendChild(tag);
    }
  });
}

export function Player({
  roomId,
  nowPlaying,
  offset,
}: {
  roomId: string;
  nowPlaying: RoomNowPlaying | null;
  offset: number;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const currentVideo = useRef<string | null>(null);
  const offsetRef = useRef(offset);
  const nowPlayingRef = useRef(nowPlaying);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [loadError, setLoadError] = useState(false);

  offsetRef.current = offset;
  nowPlayingRef.current = nowPlaying;

  const positionSeconds = (np: RoomNowPlaying) =>
    Math.max(0, (Date.now() + offsetRef.current - np.startedAt) / 1000);

  // Create the player once. YT replaces the element it's given, so we hand it
  // an imperatively-created child that React doesn't manage.
  useEffect(() => {
    let cancelled = false;
    // If the player never becomes ready, something dropped it (usually an ad
    // blocker eating the YouTube embed). Surface that instead of a black box.
    const failTimer = setTimeout(() => {
      if (!cancelled) setLoadError(true);
    }, 9000);
    void loadYouTubeApi()
      .then(() => {
        if (cancelled || !mountRef.current || !window.YT) return;
        const el = document.createElement("div");
        mountRef.current.appendChild(el);
        playerRef.current = new window.YT.Player(el, {
          width: "100%",
          height: "100%",
          // Privacy-enhanced domain; also slips past some ad-blocker rules.
          host: "https://www.youtube-nocookie.com",
          playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => {
              clearTimeout(failTimer);
              setLoadError(false);
              setReady(true);
            },
            onStateChange: (e) => {
              if (e.data === YT_STATE_ENDED && currentVideo.current) {
                void advanceTrack(roomId, currentVideo.current);
              }
            },
            onError: () => {
              if (currentVideo.current) void advanceTrack(roomId, currentVideo.current);
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(failTimer);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [roomId]);

  // Load / switch tracks and seek to the shared position (only after the user
  // gesture, since autoplay-with-sound is blocked).
  useEffect(() => {
    const player = playerRef.current;
    if (!ready || !player || !started) return;
    if (!nowPlaying) {
      player.pauseVideo();
      currentVideo.current = null;
      return;
    }
    if (currentVideo.current !== nowPlaying.videoId) {
      currentVideo.current = nowPlaying.videoId;
      player.loadVideoById({ videoId: nowPlaying.videoId, startSeconds: positionSeconds(nowPlaying) });
      player.playVideo();
    }
  }, [ready, started, nowPlaying]);

  // Drift correction + end-of-track fallback.
  useEffect(() => {
    if (!ready || !started) return;
    const id = setInterval(() => {
      const player = playerRef.current;
      const np = nowPlayingRef.current;
      if (!player || !np || currentVideo.current !== np.videoId) return;
      const expected = (Date.now() + offsetRef.current - np.startedAt) / 1000;
      const action = playbackCorrection({
        expectedSeconds: expected,
        actualSeconds: player.getCurrentTime(),
        durationMs: np.durationMs,
        driftThresholdSeconds: DRIFT_THRESHOLD_S,
      });
      if (action.kind === "advance") {
        void advanceTrack(roomId, np.videoId);
        return;
      }
      if (action.kind === "seek") {
        player.seekTo(action.toSeconds, true);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [ready, started, roomId]);

  function start() {
    setStarted(true);
    const player = playerRef.current;
    const np = nowPlayingRef.current;
    if (player && np) {
      currentVideo.current = np.videoId;
      player.loadVideoById({ videoId: np.videoId, startSeconds: positionSeconds(np) });
      player.playVideo();
    }
  }

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "16 / 9",
        background: "#000",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      {loadError ? (
        <div className="player-blocked">
          <p className="player-blocked__title">Couldn’t load the player</p>
          <p className="player-blocked__body">
            An ad blocker or privacy extension is blocking YouTube. Allow youtube.com on this site
            (or pause the blocker), then reload.
          </p>
        </div>
      ) : (
        !started && (
          <button
            onClick={start}
            className="btn btn--primary btn--lg"
            style={{
              position: "absolute",
              inset: 0,
              margin: "auto",
              width: "fit-content",
              height: "fit-content",
            }}
          >
            <Play size={17} fill="currentColor" strokeWidth={0} />
            Tap to listen in
          </button>
        )
      )}
    </div>
  );
}
