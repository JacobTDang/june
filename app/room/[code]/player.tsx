"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { advanceTrack } from "@/src/lib/room/actions";
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
  return new Promise((resolve) => {
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

  offsetRef.current = offset;
  nowPlayingRef.current = nowPlaying;

  const positionSeconds = (np: RoomNowPlaying) =>
    Math.max(0, (Date.now() + offsetRef.current - np.startedAt) / 1000);

  // Create the player once. YT replaces the element it's given, so we hand it
  // an imperatively-created child that React doesn't manage.
  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT) return;
      const el = document.createElement("div");
      mountRef.current.appendChild(el);
      playerRef.current = new window.YT.Player(el, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => setReady(true),
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
    });
    return () => {
      cancelled = true;
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
      if (expected * 1000 >= np.durationMs) {
        void advanceTrack(roomId, np.videoId);
        return;
      }
      if (Math.abs(player.getCurrentTime() - expected) > DRIFT_THRESHOLD_S) {
        player.seekTo(Math.max(0, expected), true);
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
      {!started && (
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
      )}
    </div>
  );
}
