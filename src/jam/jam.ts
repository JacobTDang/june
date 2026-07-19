import type { Jam, NowPlaying, Participant, Track } from "./types";

/** Create a new, empty jam room. */
export function createJam(id: string): Jam {
  if (!id) throw new Error("createJam: id is required");
  return { id, participants: [], queue: [], nowPlaying: null };
}

/** Add a participant. Re-joining with the same id is a no-op (safe for reconnects). */
export function join(jam: Jam, participant: Participant): Jam {
  if (!participant.id) throw new Error("join: participant id is required");
  if (!participant.name) throw new Error("join: participant name is required");
  if (jam.participants.some((p) => p.id === participant.id)) return jam;
  return { ...jam, participants: [...jam.participants, participant] };
}

/** Remove a participant. Throws if they are not in the jam. */
export function leave(jam: Jam, participantId: string): Jam {
  if (!jam.participants.some((p) => p.id === participantId)) {
    throw new Error(`leave: participant ${participantId} is not in jam ${jam.id}`);
  }
  return { ...jam, participants: jam.participants.filter((p) => p.id !== participantId) };
}

function assertValidTrack(track: Track): void {
  if (!track.id) throw new Error("enqueue: track id is required");
  if (!track.videoId) throw new Error("enqueue: track videoId is required");
  if (!track.title) throw new Error("enqueue: track title is required");
  if (!(track.durationMs > 0)) {
    throw new Error(`enqueue: track ${track.id} must have durationMs > 0`);
  }
}

/**
 * Add a track. Anyone in the jam can enqueue (collaborative FIFO).
 * If nothing is playing, the track starts immediately at `now`.
 */
export function enqueue(jam: Jam, track: Track, now: number): Jam {
  assertValidTrack(track);
  if (!jam.participants.some((p) => p.id === track.addedBy)) {
    throw new Error(`enqueue: ${track.addedBy} is not in jam ${jam.id}`);
  }
  const alreadyPresent =
    jam.nowPlaying?.track.id === track.id ||
    jam.queue.some((t) => t.id === track.id);
  if (alreadyPresent) {
    throw new Error(`enqueue: track ${track.id} is already in jam ${jam.id}`);
  }

  if (jam.nowPlaying === null) {
    return { ...jam, nowPlaying: { track, startedAt: now } };
  }
  return { ...jam, queue: [...jam.queue, track] };
}

/** Current playback position in ms, or null if nothing is playing. */
export function currentPosition(jam: Jam, now: number): number | null {
  if (!jam.nowPlaying) return null;
  return now - jam.nowPlaying.startedAt;
}

/**
 * Advance playback to reflect time elapsed up to `now`. Any track whose end
 * has passed is retired and the next queued track takes over, timed
 * back-to-back (startedAt = previous end) so the shared clock never drifts.
 * When the queue empties, playback stops (nowPlaying = null).
 */
export function tick(jam: Jam, now: number): Jam {
  if (!jam.nowPlaying) return jam;

  let nowPlaying: NowPlaying = jam.nowPlaying;
  let queue = jam.queue;
  let stopped = false;

  while (now - nowPlaying.startedAt >= nowPlaying.track.durationMs) {
    const endedAt = nowPlaying.startedAt + nowPlaying.track.durationMs;
    const [next, ...rest] = queue;
    if (!next) {
      stopped = true;
      queue = [];
      break;
    }
    nowPlaying = { track: next, startedAt: endedAt };
    queue = rest;
  }

  if (!stopped && nowPlaying === jam.nowPlaying && queue === jam.queue) return jam;
  return { ...jam, nowPlaying: stopped ? null : nowPlaying, queue };
}

/**
 * Skip the current track and start the next queued one at `now`.
 * If the queue is empty, playback stops. Throws if nothing is playing.
 */
export function skip(jam: Jam, now: number): Jam {
  if (!jam.nowPlaying) throw new Error(`skip: nothing is playing in jam ${jam.id}`);
  const [next, ...rest] = jam.queue;
  if (!next) return { ...jam, nowPlaying: null, queue: [] };
  return { ...jam, nowPlaying: { track: next, startedAt: now }, queue: rest };
}

/** Remove a not-yet-played track from the queue. Throws if it isn't queued. */
export function removeFromQueue(jam: Jam, trackId: string): Jam {
  if (!jam.queue.some((t) => t.id === trackId)) {
    throw new Error(`removeFromQueue: track ${trackId} is not queued in jam ${jam.id}`);
  }
  return { ...jam, queue: jam.queue.filter((t) => t.id !== trackId) };
}
