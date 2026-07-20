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
    <main className="container">
      <a href="/" className="muted">
        ← back
      </a>
      <h1 className="display" style={{ fontSize: "2rem" }}>
        Your playlists
      </h1>

      {playlists.length === 0 ? (
        <p className="muted">No playlists found on your account.</p>
      ) : (
        <ul className="list">
          {playlists.map((p) => (
            <li key={p.id} className="card row">
              {p.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnailUrl} alt="" className="thumb" />
              ) : (
                <div className="thumb" />
              )}
              <span>
                <strong>{p.title}</strong>
                <span className="muted"> · {p.itemCount} songs</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
