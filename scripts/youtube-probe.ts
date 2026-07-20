/**
 * Smoke-test the YouTube layer against the real API.
 *
 *   YT_API_KEY=… npx tsx scripts/youtube-probe.ts "search query"
 *
 * Set YT_TOKEN (an OAuth access token, e.g. from the OAuth 2.0 Playground) to
 * also list your playlists.
 */
import { createYouTubeClient, searchTracks } from "../src/youtube/index";
import { formatDuration } from "./format";

const apiKey = process.env.YT_API_KEY;
if (!apiKey) {
  console.error(
    "Set YT_API_KEY to your YouTube Data API key. Optionally set YT_TOKEN to list playlists.",
  );
  process.exit(1);
}

const accessToken = process.env.YT_TOKEN;
const query = process.argv[2] ?? "lofi hip hop";
const client = createYouTubeClient({ apiKey, accessToken });

console.log(`\n🔎  Searching: "${query}"\n`);
const { tracks, skipped } = await searchTracks(client, query, "probe", { maxResults: 10 });
for (const t of tracks) {
  console.log(
    `  ${formatDuration(t.durationMs).padStart(6)}  ${t.title}  —  ${t.artist ?? "?"}  [${t.videoId}]`,
  );
}
if (skipped.length > 0) {
  console.log(
    `\n  skipped ${skipped.length}: ${skipped.map((s) => `${s.title} (${s.reason})`).join(", ")}`,
  );
}

if (accessToken) {
  console.log(`\n📃  Your playlists:\n`);
  const playlists = await client.listPlaylists();
  for (const p of playlists) {
    console.log(`  ${String(p.itemCount).padStart(4)} songs   ${p.title}   [${p.id}]`);
  }
} else {
  console.log(`\n(Set YT_TOKEN to also list your playlists.)`);
}
