"use client";

import { useRef, useState } from "react";
import { Music, Pause, Play, Search, SkipBack, SkipForward } from "lucide-react";
import { getAudiusTracks } from "@/src/lib/audius-fetch";
import type { AudiusTrack } from "@/src/lib/audius";

/**
 * A plain <audio> element + the Media Session API. That pairing is what keeps
 * audio playing with the screen off / app backgrounded on mobile — the thing a
 * cross-origin YouTube video iframe can never do. Refs keep the lock-screen
 * action handlers pointed at the current track/index.
 */
export function AudiusPlayer({ initialTracks }: { initialTracks: AudiusTrack[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<AudiusTrack[]>(initialTracks);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const indexRef = useRef(index);
  indexRef.current = index;

  const current = index !== null ? (tracks[index] ?? null) : null;

  function setMediaSession(track: AudiusTrack) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: "Audius · june labs",
      artwork: track.artworkUrl
        ? [{ src: track.artworkUrl, sizes: "480x480", type: "image/jpeg" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", resume);
    navigator.mediaSession.setActionHandler("pause", pauseAudio);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
  }

  function playIndex(i: number) {
    const audio = audioRef.current;
    const list = tracksRef.current;
    if (!audio || i < 0 || i >= list.length) return;
    const track = list[i];
    if (!track) return;
    setIndex(i);
    audio.src = track.streamUrl;
    void audio.play().catch(() => setPlaying(false));
    setMediaSession(track);
  }
  function next() {
    const i = indexRef.current;
    const n = tracksRef.current.length;
    if (i !== null && n > 0) playIndex((i + 1) % n);
  }
  function prev() {
    const i = indexRef.current;
    const n = tracksRef.current.length;
    if (i !== null && n > 0) playIndex((i - 1 + n) % n);
  }
  function resume() {
    void audioRef.current?.play().catch(() => {});
  }
  function pauseAudio() {
    audioRef.current?.pause();
  }
  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) resume();
    else pauseAudio();
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setTracks(await getAudiusTracks(query));
      setIndex(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        onPlay={() => {
          setPlaying(true);
          if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
        }}
        onPause={() => {
          setPlaying(false);
          if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
        }}
        onEnded={next}
      />

      <form className="lab-search" onSubmit={onSearch}>
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Audius (or leave blank for trending)"
          aria-label="Search Audius"
        />
        <button className="btn" disabled={busy} aria-label="Search">
          <Search size={15} />
        </button>
      </form>

      <ul className="lab-list">
        {tracks.map((t, i) => (
          <li key={t.id}>
            <button
              type="button"
              className={`lab-track${i === index ? " lab-track--on" : ""}`}
              onClick={() => playIndex(i)}
            >
              <span className="lab-track__art">
                {t.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <Music size={16} />
                )}
              </span>
              <span className="lab-track__meta">
                <span className="lab-track__title">{t.title}</span>
                <span className="lab-track__artist">{t.artist}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {current && (
        <div className="lab-bar">
          <span className="lab-bar__art">
            {current.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.artworkUrl} alt="" />
            ) : (
              <Music size={18} />
            )}
          </span>
          <span className="lab-bar__meta">
            <span className="lab-bar__title">{current.title}</span>
            <span className="lab-bar__artist">{current.artist}</span>
          </span>
          <span className="lab-bar__controls">
            <button type="button" onClick={prev} aria-label="Previous">
              <SkipBack size={18} />
            </button>
            <button
              type="button"
              className="lab-bar__play"
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause size={18} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={18} fill="currentColor" strokeWidth={0} />
              )}
            </button>
            <button type="button" onClick={next} aria-label="Next">
              <SkipForward size={18} />
            </button>
          </span>
        </div>
      )}
    </>
  );
}
