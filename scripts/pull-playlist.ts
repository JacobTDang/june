/**
 * Pull every track from a YouTube playlist and print it.
 *
 *   YT_API_KEY=… YT_TOKEN=… npx tsx scripts/pull-playlist.ts <playlist id or url>
 *
 * Accepts a full playlist URL (…?list=PL…) or a bare playlist id. YT_TOKEN is an
 * OAuth access token (e.g. from the OAuth 2.0 Playground).
 */
import { createYouTubeClient, importPlaylist } from "../src/youtube/index";
import { formatDuration } from "./format";

const apiKey = process.env.YT_API_KEY;
const accessToken = process.env.YT_TOKEN;
const input = process.argv[2];

if (!apiKey || !accessToken || !input) {
  console.error(
    "Usage: YT_API_KEY=… YT_TOKEN=… npx tsx scripts/pull-playlist.ts <playlist id or url>",
  );
  process.exit(1);
}

/** Accept a full playlist URL (…?list=PL…) or a bare id. */
function extractPlaylistId(value: string): string {
  const match = value.match(/[?&]list=([^&]+)/);
  return match ? match[1]! : value;
}

const playlistId = extractPlaylistId(input);
const client = createYouTubeClient({ apiKey, accessToken });

console.log(`\n⬇️   Pulling playlist ${playlistId}\n`);
const { tracks, skipped } = await importPlaylist(client, playlistId, "probe");

let totalMs = 0;
tracks.forEach((t, i) => {
  totalMs += t.durationMs;
  console.log(
    `  ${String(i + 1).padStart(3)}.  ${formatDuration(t.durationMs).padStart(6)}  ${t.title}  —  ${t.artist ?? "?"}`,
  );
});

console.log(`\n  ${tracks.length} playable tracks · ${formatDuration(totalMs)} total`);
if (skipped.length > 0) {
  console.log(`  ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`    - ${s.title} (${s.reason})`);
}
