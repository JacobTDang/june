import Link from "next/link";
import { getPastJams, getRecentPlays } from "@/src/lib/room/plays";

/** "3 minutes ago", "yesterday" — coarse on purpose; a play doesn't need a clock. */
function when(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Everyone but you, read as a sentence: "with Esther and Christopher". */
function withWhom(others: string[]): string {
  if (others.length === 0) return "on your own";
  if (others.length === 1) return `with ${others[0]}`;
  if (others.length === 2) return `with ${others[0]} and ${others[1]}`;
  return `with ${others[0]}, ${others[1]} and ${others.length - 2} more`;
}

/**
 * What you've been listening to, on the home page. A server component: both
 * reads are RLS-scoped to the signed-in user, so there is nothing to guard
 * here beyond rendering nothing when there's no history yet.
 */
export async function RecentPlays() {
  const [plays, jams] = await Promise.all([getRecentPlays(8), getPastJams(4)]);
  if (plays.length === 0) return null;

  return (
    <div className="home-history">
      <div className="eyebrow">You&rsquo;ve been listening to</div>
      <ul className="home-history__list">
        {plays.map((play) => (
          <li key={`${play.roomId}:${play.videoId}:${play.playedAt}`} className="home-play">
            {play.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="home-play__art" src={play.thumbnailUrl} alt="" />
            ) : (
              <div className="home-play__art" />
            )}
            <div className="home-play__meta">
              <span className="home-play__title">{play.title}</span>
              <span className="home-play__sub">
                {play.artist ?? "Unknown artist"} · {when(play.playedAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {jams.length > 0 && (
        <>
          <div className="eyebrow home-history__head">Jams you were in</div>
          <ul className="home-history__jams">
            {jams.map((jam) => (
              <li key={jam.roomId} className="home-jamrow">
                {/* The room itself is long deleted — this is a memory, not a
                    link back into it. */}
                <span className="home-jamrow__when">{when(jam.lastPlayedAt)}</span>
                <span className="home-jamrow__who">{withWhom(jam.others)}</span>
                <span className="home-jamrow__count">
                  {jam.trackCount} {jam.trackCount === 1 ? "track" : "tracks"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link className="home-history__more" href="/profile">
        Your taste
      </Link>
    </div>
  );
}
