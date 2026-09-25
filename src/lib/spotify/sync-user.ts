import type { SpotifyClient } from "../../spotify/client";
import {
  advanceCursor,
  dailyPassDue,
  freshLikes,
  likesToRemove,
  planPlaylists,
  recentGap,
  type StoredPlaylist,
} from "../../spotify/diff";
import { SPOTIFY_PAGE_SIZE, TIME_RANGES, type TimeRange } from "../../spotify/limits";
import {
  toPlaylistMeta,
  toSongRow,
  toTasteArtist,
  toTasteTrack,
  uniqueSongRows,
  type PlaylistMeta,
  type SongRow,
  type TasteArtist,
  type TasteTrack,
} from "../../spotify/map";
import type { SpotifyTrack } from "../../spotify/schema";

/**
 * One user's sync, written against three interfaces so it can be tested with
 * in-memory fakes. Deliberately free of Supabase and `server-only`: the
 * Supabase-backed store lives in ./store.ts, and ./sync.ts saves progress.
 */

export type TasteSnapshot =
  | { kind: "artists"; range: TimeRange; items: TasteArtist[] }
  | { kind: "tracks"; range: TimeRange; items: TasteTrack[] };

export interface LibraryStore {
  /** Insert or refresh songs; returns Spotify id → song uuid for every row. */
  upsertSongs(rows: SongRow[]): Promise<Map<string, string>>;
  /** Ignores plays already stored. */
  addListens(userId: string, listens: { songId: string; playedAt: string }[]): Promise<void>;
  newestLikeAt(userId: string): Promise<string | null>;
  /** Ignores likes already stored. */
  addLikes(userId: string, likes: { songId: string; addedAt: string }[]): Promise<void>;
  likedSongIds(userId: string): Promise<string[]>;
  removeLikes(userId: string, songIds: string[]): Promise<void>;
  storedPlaylists(userId: string): Promise<StoredPlaylist[]>;
  /** Insert or rename playlists without touching their songs or snapshot;
   *  returns Spotify id → playlist uuid. */
  upsertPlaylists(userId: string, playlists: PlaylistMeta[]): Promise<Map<string, string>>;
  /** Replace a playlist's songs and record its snapshot, as one step. */
  replacePlaylistSongs(
    playlistId: string,
    songs: { songId: string; addedAt: string | null }[],
    snapshotId: string,
  ): Promise<void>;
  removePlaylists(userId: string, sourceIds: string[]): Promise<void>;
  saveTaste(userId: string, snapshot: TasteSnapshot): Promise<void>;
}

/**
 * Saved as each stage finishes rather than once at the end, so a stage that
 * fails every run (one playlist answering 403, say) can't make every run
 * repeat the stages before it.
 */
export interface SyncProgress {
  /** Listens are stored; saving the cursor now means a later failure can't make the next run fetch them again. */
  listensSaved(recentCursor: string | null, gap: { from: string; to: string } | null): Promise<void>;
  /** Every like was read (unlikes dropped) and the top lists saved; the next run needn't repeat it for a day. */
  dailyPassSaved(): Promise<void>;
}

export interface SyncInput {
  userId: string;
  spotifyUserId: string;
  recentCursor: string | null;
  lastDailySyncAt: string | null;
}

export interface SyncOutcome {
  recentCursor: string | null;
  /** True when this run did the daily pass (full likes + taste). */
  dailyDone: boolean;
  /** Set when plays may have been lost past Spotify's 50-play window. */
  gap: { from: string; to: string } | null;
}

/** 20,000 likes. Hitting it means paging broke, not that someone likes that much. */
const MAX_LIKE_PAGES = 400;

function songIdFor(ids: ReadonlyMap<string, string>, sourceId: string): string {
  const id = ids.get(sourceId);
  if (id === undefined) throw new Error(`songs upsert returned no id for Spotify track ${sourceId}`);
  return id;
}

/** Entries whose track is a song june can use, each with its song row. */
function withSongs<T extends { track: SpotifyTrack | null }>(entries: readonly T[]): (T & { row: SongRow })[] {
  const out: (T & { row: SongRow })[] = [];
  for (const entry of entries) {
    const row = entry.track === null ? null : toSongRow(entry.track);
    if (row !== null) out.push({ ...entry, row });
  }
  return out;
}

/**
 * Stages run cheapest-to-lose first, and progress is saved after each one:
 * listens (then the cursor), likes, the daily pass's top lists (then its
 * timestamp), and playlists last, since one bad playlist is the likeliest
 * thing to fail on every run. A failure anywhere rejects; the stages already
 * saved stay saved.
 */
export async function syncUser(
  input: SyncInput,
  spotify: SpotifyClient,
  store: LibraryStore,
  progress: SyncProgress,
  now: Date,
): Promise<SyncOutcome> {
  const daily = dailyPassDue(input.lastDailySyncAt, now);

  const recent = await spotify.recentlyPlayed(
    input.recentCursor === null ? null : Date.parse(input.recentCursor),
  );
  const played = withSongs(recent.map((item) => ({ track: item.track, at: item.played_at })));
  const playedIds = await store.upsertSongs(uniqueSongRows(played.map((p) => p.row)));
  await store.addListens(
    input.userId,
    played.map((p) => ({ songId: songIdFor(playedIds, p.row.source_id), playedAt: p.at })),
  );
  const playedAt = recent.map((item) => item.played_at);
  const recentCursor = advanceCursor(playedAt, input.recentCursor);
  const gap = recentGap(playedAt, input.recentCursor);
  await progress.listensSaved(recentCursor, gap);

  await syncLikes(input.userId, daily, spotify, store);
  if (daily) {
    await syncTaste(input.userId, spotify, store);
    await progress.dailyPassSaved();
  }

  await syncPlaylists(input, spotify, store);

  return { recentCursor, dailyDone: daily, gap };
}

/**
 * Between daily passes, read likes newest first and stop at the first one
 * already stored. On the daily pass read them all, then drop stored likes that
 * weren't seen: Spotify has no "unliked" feed, so this is how an unlike lands.
 * A page that fails throws before anything is dropped, so a partial read
 * can't pass for a full one.
 */
async function syncLikes(
  userId: string,
  full: boolean,
  spotify: SpotifyClient,
  store: LibraryStore,
): Promise<void> {
  const newestKnown = full ? null : await store.newestLikeAt(userId);
  const seen = new Set<string>();

  for (let page = 0; ; page++) {
    if (page >= MAX_LIKE_PAGES) {
      throw new Error(`liked songs were still paging after ${MAX_LIKE_PAGES} pages`);
    }
    const { items, next } = await spotify.savedTracks(page * SPOTIFY_PAGE_SIZE);
    const { fresh, done } = freshLikes(items, newestKnown);
    const liked = withSongs(fresh.map((item) => ({ track: item.track, at: item.added_at })));
    const ids = await store.upsertSongs(uniqueSongRows(liked.map((l) => l.row)));
    const likes = liked.map((l) => ({ songId: songIdFor(ids, l.row.source_id), addedAt: l.at }));
    await store.addLikes(userId, likes);
    for (const like of likes) seen.add(like.songId);
    if (done || next === null) break;
  }

  if (full) {
    await store.removeLikes(userId, likesToRemove(await store.likedSongIds(userId), seen));
  }
}

async function syncPlaylists(
  input: SyncInput,
  spotify: SpotifyClient,
  store: LibraryStore,
): Promise<void> {
  const plan = planPlaylists(
    await spotify.myPlaylists(),
    await store.storedPlaylists(input.userId),
    input.spotifyUserId,
  );
  const playlistIds = await store.upsertPlaylists(input.userId, plan.mine.map(toPlaylistMeta));

  for (const playlist of plan.refresh) {
    const playlistId = playlistIds.get(playlist.id);
    if (playlistId === undefined) {
      throw new Error(`playlists upsert returned no id for Spotify playlist ${playlist.id}`);
    }
    const entries = withSongs(
      (await spotify.playlistItems(playlist.id)).map((item) => ({
        track: item.item,
        at: item.added_at ?? null,
      })),
    );
    const songIds = await store.upsertSongs(uniqueSongRows(entries.map((e) => e.row)));
    await store.replacePlaylistSongs(
      playlistId,
      entries.map((e) => ({ songId: songIdFor(songIds, e.row.source_id), addedAt: e.at })),
      playlist.snapshot_id,
    );
  }

  await store.removePlaylists(input.userId, plan.remove);
}

async function syncTaste(userId: string, spotify: SpotifyClient, store: LibraryStore): Promise<void> {
  for (const range of TIME_RANGES) {
    const artists = await spotify.topArtists(range);
    await store.saveTaste(userId, { kind: "artists", range, items: artists.map(toTasteArtist) });

    const tracks = withSongs((await spotify.topTracks(range)).map((track) => ({ track })));
    await store.upsertSongs(uniqueSongRows(tracks.map((t) => t.row)));
    await store.saveTaste(userId, { kind: "tracks", range, items: tracks.map((t) => toTasteTrack(t.row)) });
  }
}
