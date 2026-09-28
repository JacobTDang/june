"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { addVideoById } from "@/src/lib/room/add-music";
import type { VideoMeta } from "@/src/lib/video-cache";
import type { Playlist } from "../playlist-carousel";
import { Cover } from "./cover";
import { unwrap, type AddRunner } from "./runner";

/** A YouTube playlist opened for picking: back, its title, "Add all", and
 *  its songs. Used by the search tab (a pasted link) and the playlists tab. */
export function PlaylistView({
  roomId,
  playlist,
  tracks,
  truncated,
  backLabel,
  onBack,
  onAddAll,
  runner,
}: {
  roomId: string;
  playlist: Playlist;
  tracks: VideoMeta[] | null;
  truncated: boolean;
  backLabel: string;
  onBack: () => void;
  onAddAll: () => Promise<number>;
  runner: AddRunner;
}) {
  const { busy, run } = runner;
  return (
    <>
      <div className="add__plhead">
        <button className="btn btn--sm" onClick={onBack}>
          <ArrowLeft size={15} />
          {backLabel}
        </button>
        <span className="add__pltitle">{playlist.title}</span>
        <button className="btn btn--sm" disabled={busy} onClick={() => run(onAddAll, (n) => `Added ${n} songs.`)}>
          Add all
        </button>
      </div>
      {truncated && (
        <p className="add__hint">
          Showing the first {tracks?.length ?? 0} of {playlist.itemCount}. “Add all” takes the whole playlist.
        </p>
      )}
      {tracks === null ? (
        <p className="muted">Loading songs…</p>
      ) : (
        <ul className="add__list">
          {tracks.map((t) => (
            <li key={t.videoId} className="add__result">
              <Cover url={t.thumbnailUrl} />
              <div className="add__meta">
                <div className="add__title">{t.title}</div>
                <div className="add__sub">
                  {t.artist ?? ""}
                  {!t.embeddable ? " · can’t play here" : ""}
                </div>
              </div>
              <button
                className="add__btn"
                disabled={busy || !t.embeddable}
                aria-label={`Add ${t.title}`}
                onClick={() =>
                  run(
                    async () => unwrap(await addVideoById(roomId, t.videoId)),
                    () => `Added “${t.title}”`,
                  )
                }
              >
                <Plus size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
