import { cookies } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
import { createYouTubeClient } from "@/src/youtube";

const wrap = { maxWidth: 640, margin: "0 auto", padding: "5rem 1.5rem" } as const;

export default async function PlaylistsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main style={wrap}>
        <p>
          You&apos;re not signed in. <a href="/">Go back and sign in</a>.
        </p>
      </main>
    );
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  const providerToken = (await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value;

  if (!apiKey) {
    return (
      <main style={wrap}>
        <p>Set <code>YOUTUBE_API_KEY</code> in <code>.env.local</code> and restart.</p>
      </main>
    );
  }
  if (!providerToken) {
    return (
      <main style={wrap}>
        <p>
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
      <main style={wrap}>
        <p>Couldn&apos;t load your playlists: {(err as Error).message}</p>
        <p>
          Your Google token may have expired — <a href="/">sign in again</a>.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <a href="/">← back</a>
      <h1 style={{ fontSize: "2rem", margin: "1rem 0" }}>Your playlists</h1>
      {playlists.length === 0 ? (
        <p>No playlists found on your account.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {playlists.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              {p.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnailUrl} alt="" width={64} height={48} style={{ borderRadius: 4, objectFit: "cover" }} />
              ) : (
                <div style={{ width: 64, height: 48, borderRadius: 4, background: "#eee" }} />
              )}
              <span>
                <strong>{p.title}</strong>
                <span style={{ color: "#777" }}> · {p.itemCount} songs</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
