import { ArrowLeft } from "lucide-react";
import { createClient } from "@/src/lib/supabase/server";
import { getYouTubeAccessToken } from "@/src/lib/supabase/youtube-auth";
import { describeYouTubeError } from "@/src/lib/supabase/youtube-error";
import { meteredFetch } from "@/src/lib/metrics/youtube-usage";
import { createYouTubeClient } from "@/src/youtube";

export default async function PlaylistsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container">
        <p className="muted">
          You&apos;re not signed in. <a href="/">Go back and sign in</a>.
        </p>
      </main>
    );
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return (
      <main className="container">
        <p className="muted">
          Set <code>YOUTUBE_API_KEY</code> in <code>.env.local</code> and restart.
        </p>
      </main>
    );
  }

  let playlists;
  try {
    const accessToken = await getYouTubeAccessToken();
    if (!accessToken) {
      return (
        <main className="container">
          <p className="muted">
            YouTube isn&apos;t connected. <a href="/">Connect it from the home page</a>.
          </p>
        </main>
      );
    }
    const client = createYouTubeClient({ apiKey, accessToken, fetch: meteredFetch() });
    playlists = await client.listPlaylists();
  } catch (err) {
    const info = describeYouTubeError(err);
    return (
      <main className="container">
        {info.kind === "not-configured" ? (
          <p className="muted">YouTube isn&apos;t set up on this server yet.</p>
        ) : info.kind === "not-connected" ? (
          <p className="muted">
            YouTube isn&apos;t connected. <a href="/">Connect it from the home page</a>.
          </p>
        ) : (
          <>
            <p className="muted">Couldn&apos;t load your playlists: {info.message}</p>
            <p className="muted">
              Your YouTube connection may need refreshing. <a href="/">Reconnect it</a>.
            </p>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <header className="pl__head">
        <h1 className="pl__title">Your playlists</h1>
        <span className="pl__count">
          {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
        </span>
      </header>

      {playlists.length === 0 ? (
        <div className="pl__empty">
          <p className="pl__empty-title">No playlists yet</p>
          <p className="muted">Playlists from your YouTube account will show up here.</p>
        </div>
      ) : (
        <ul className="pl__grid">
          {playlists.map((p) => (
            <li key={p.id} className="pl__item">
              <div className={`pl__cover${p.thumbnailUrl ? "" : " pl__cover--empty"}`}>
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden="true">♪</span>
                )}
              </div>
              <div className="pl__meta">
                <div className="pl__name" title={p.title}>
                  {p.title}
                </div>
                <div className="pl__sub">
                  {p.itemCount} {p.itemCount === 1 ? "song" : "songs"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
