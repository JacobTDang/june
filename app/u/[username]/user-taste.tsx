import { getPlaysFor, getTopArtists } from "@/src/lib/room/plays";

/**
 * What someone has been listening to, on their profile.
 *
 * There is no permission check here on purpose. The `plays` policy already
 * says who may read these rows — you, and anyone who was in a room with you —
 * so a stranger's query comes back empty and this renders nothing. Duplicating
 * the rule in the UI would be a second place for it to drift.
 */
export async function UserTaste({ userId }: { userId: string }) {
  const [artists, plays] = await Promise.all([getTopArtists(userId, 5), getPlaysFor(userId, 6)]);
  if (artists.length === 0 && plays.length === 0) return null;

  return (
    <div className="u__taste">
      {artists.length > 0 && (
        <section>
          <div className="eyebrow">On repeat</div>
          <ul className="u__artists">
            {artists.map((a) => (
              <li key={a.artist} className="u__artist">
                <span className="u__artist-name">{a.artist}</span>
                <span className="u__artist-plays">
                  {a.plays} {a.plays === 1 ? "play" : "plays"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plays.length > 0 && (
        <section>
          <div className="eyebrow">Recently played</div>
          <ul className="u__plays">
            {plays.map((play) => (
              <li key={`${play.roomId}:${play.videoId}:${play.playedAt}`} className="u__play">
                {play.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="u__play-art" src={play.thumbnailUrl} alt="" />
                ) : (
                  <div className="u__play-art" />
                )}
                <div className="u__play-meta">
                  <span className="u__play-title">{play.title}</span>
                  <span className="u__play-artist">{play.artist ?? "Unknown artist"}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
