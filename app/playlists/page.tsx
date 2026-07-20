import { cookies } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
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
  const providerToken = (await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value;

  if (!apiKey) {
    return (
      <main className="container">
        <p className="muted">
          Set <code>YOUTUBE_API_KEY</code> in <code>.env.local</code> and restart.
        </p>
      </main>
    );
  }
  if (!providerToken) {
    return (
      <main className="container">
        <p className="muted">
          No Google token found — <a href="/">sign in again</a>.
        </p>
      </main>
    );
  }

  const client = createYouTubeClient({ apiKey, accessToken: providerToken });

  let playlists;
  try {
    playlists = await client.listPlaylists();
  } catch (err) {
    return (
      <main className="container">
        <p className="muted">Couldn&apos;t load your playlists: {(err as Error).message}</p>
        <p className="muted">
          Your Google token may have expired — <a href="/">sign in again</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        ← Back
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
