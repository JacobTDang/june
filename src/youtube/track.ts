import { newId } from "../jam/ids";
import type { Track } from "../jam/types";
import { parseIso8601Duration } from "./duration";
import type { YouTubeThumbnails, YouTubeVideoItem } from "./schema";

/**
 * The anti-corruption layer between the YouTube API and the jam domain: it maps
 * external video resources into our own `Track` shape, and separates out the
 * videos that can't actually play in an embedded player so the caller can tell
 * the user why instead of dropping them silently.
 */

/** Why a YouTube video can't become a playable jam track. */
export type SkipReason = "not-embeddable" | "live" | "no-duration";

export interface SkippedVideo {
  videoId: string;
  title: string;
  reason: SkipReason;
}

export interface VideoConversion {
  tracks: Track[];
  skipped: SkippedVideo[];
}

/** Pick the highest-resolution thumbnail available, if any. */
export function pickThumbnail(thumbnails?: YouTubeThumbnails): string | undefined {
  if (!thumbnails) return undefined;
  const best =
    thumbnails.maxres ??
    thumbnails.standard ??
    thumbnails.high ??
    thumbnails.medium ??
    thumbnails.default;
  return best?.url;
}

/**
 * Map a single YouTube video into a jam `Track`. `id` is the queue-entry id
 * (pass `newId()` in real code). Assumes the video is playable - run it through
 * `videosToTracks` to filter first.
 */
export function toTrack(video: YouTubeVideoItem, addedBy: string, id: string): Track {
  return {
    id,
    videoId: video.id,
    title: video.snippet.title,
    durationMs: parseIso8601Duration(video.contentDetails.duration),
    addedBy,
    artist: video.snippet.channelTitle,
    thumbnailUrl: pickThumbnail(video.snippet.thumbnails),
  };
}

function classify(video: YouTubeVideoItem): "playable" | SkipReason {
  if (video.status?.embeddable === false) return "not-embeddable";
  const live = video.snippet.liveBroadcastContent;
  if (live !== undefined && live !== "none") return "live";
  if (parseIso8601Duration(video.contentDetails.duration) <= 0) return "no-duration";
  return "playable";
}

/**
 * Convert a batch of YouTube videos into jam `Track`s, separating out the ones
 * that can't play here (embedding disabled, live, or no fixed duration) with a
 * reason attached. A malformed duration is *not* skipped - it throws, since
 * that signals an unexpected API change we want to know about.
 */
export function videosToTracks(
  videos: YouTubeVideoItem[],
  addedBy: string,
  makeId: () => string = newId,
): VideoConversion {
  const tracks: Track[] = [];
  const skipped: SkippedVideo[] = [];

  for (const video of videos) {
    const verdict = classify(video);
    if (verdict === "playable") {
      tracks.push(toTrack(video, addedBy, makeId()));
    } else {
      skipped.push({ videoId: video.id, title: video.snippet.title, reason: verdict });
    }
  }

  return { tracks, skipped };
}
