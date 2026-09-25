import { when } from "@/src/lib/when";
import type { LibrarySong } from "@/src/lib/spotify/library";

/** Songs with their art, artists and when they were liked or played. Reuses
 *  the home page's history rows so the two lists read the same. */
export function SongList({ songs, now }: { songs: LibrarySong[]; now: number }) {
  return (
    <ul className="home-history__list">
      {songs.map((song, i) => (
        <li key={`${song.at}:${i}`} className="home-play">
          {song.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="home-play__art" src={song.artworkUrl} alt="" loading="lazy" />
          ) : (
            <div className="home-play__art" />
          )}
          <div className="home-play__meta">
            <span className="home-play__title">{song.title}</span>
            <span className="home-play__sub">
              {song.artists.join(", ")} · {when(song.at, now)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
