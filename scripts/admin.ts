#!/usr/bin/env node
/**
 * june admin CLI — owner-only ops from your machine.
 *
 * Login is a browser round-trip: it opens Google sign-in, catches the callback on
 * a one-shot loopback server, and checks the account is ADMIN_EMAIL. The session
 * is cached under ~/.june so day-to-day commands don't reopen the browser. The
 * actual DB work uses the service-role key.
 *
 * Run it as `june <cmd>` after a one-time `npm link`, or `npm run admin -- <cmd>`:
 *   june login | logout
 *   june metrics | users | user <email> | rooms
 *   june rm-room [code] | sweep | rm-user <email>
 *
 * Never deploy this.
 */
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  isOwner,
  parseAuthCallback,
  parseSessionCache,
  sessionUsable,
} from "../src/lib/admin/cli-auth.ts";
import { clampIndex, renderRoomPicker, type RoomChoice } from "../src/lib/admin/room-picker.ts";

// Load .env.local relative to this file, so `june` works from any directory
// (and `npm run admin` no longer needs an explicit --env-file).
try {
  process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local"));
} catch {
  /* env may already be present (--env-file or real deploy vars); the check below catches a real miss */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — check your .env.local.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const DAILY_QUOTA = 10_000;

/** Calendar date in America/Los_Angeles (YouTube quota resets midnight PT). */
function pacificDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** All auth users (listUsers is paginated). */
async function allUsers(): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

function findByEmail(users: User[], email: string): User | undefined {
  const e = email.trim().toLowerCase();
  return users.find((u) => (u.email ?? "").toLowerCase() === e);
}

const shortDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

async function confirm(question: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim() === expected;
}

// ---- Owner login: Google in the browser, caught on a loopback server ----
// The service-role key in .env.local is the real credential; this login is a
// deliberate owner gate with no shared secret on disk, not a wall against
// whoever already holds that file.

const REDIRECT_PORT = 9789;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SESSION_DIR = join(homedir(), ".june");
const SESSION_FILE = join(SESSION_DIR, "admin-session.json");

/** Anon client for the auth handshake. PKCE with an in-process verifier store,
 *  so signInWithOAuth and exchangeCodeForSession share the same verifier. */
function makeAuthClient(anonKey: string) {
  const store = new Map<string, string>();
  return createClient(url!, anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      },
    },
  });
}

function openInBrowser(target: string): void {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? 'start ""' : "xdg-open";
  exec(`${opener} "${target}"`);
}

function resultPage(ok: boolean, detail: string): string {
  const heading = ok ? "Authentication successful" : "Sign-in failed";
  const pill = ok ? "Signed in" : "Couldn’t sign in";
  const safe = detail.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>june admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&display=swap" rel="stylesheet" />
<style>
  :root { --bg:#100f12; --ink:#f4f1ea; --muted:#8b8790; --accent:#f2b552; }
  * { box-sizing:border-box; }
  html,body { height:100%; margin:0; }
  body { background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:flex; align-items:center; justify-content:center; padding:2rem; }
  .card { text-align:center; max-width:32rem; }
  .pill { display:inline-flex; align-items:center; gap:.5rem; margin:0 0 1.5rem;
    padding:.34rem .8rem; border-radius:999px; font-size:.8rem; font-weight:600;
    letter-spacing:.02em; background:rgba(242,181,82,.12); color:var(--accent); }
  .pill--err { background:rgba(255,255,255,.06); color:var(--muted); }
  .pill .dot { width:7px; height:7px; border-radius:50%; background:currentColor; }
  h1 { font-family:"Fraunces",Georgia,serif; font-weight:500; font-size:2.4rem;
    line-height:1.08; letter-spacing:-.01em; margin:0 0 .65rem; }
  p { margin:0; color:var(--muted); font-size:1rem; line-height:1.5; }
</style>
</head>
<body>
  <div class="card">
    <span class="pill${ok ? "" : " pill--err"}"><span class="dot"></span>${pill}</span>
    <h1>${heading}</h1>
    <p>${safe}</p>
  </div>
</body>
</html>`;
}

/** Serve exactly one loopback callback and hand back the auth code. */
function waitForCallback(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = req.url ?? "";
      if (!path.startsWith("/callback")) {
        res.writeHead(404).end(); // ignore favicon and friends — keep waiting
        return;
      }
      const result = parseAuthCallback(path);
      clearTimeout(timer);
      if ("code" in result) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(resultPage(true, "You can close this tab and return to the terminal."));
        server.close();
        resolve(result.code);
      } else {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(resultPage(false, result.error));
        server.close();
        reject(new Error(result.error));
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the browser sign-in (2 minutes)."));
    }, 120_000);
    server.once("error", (e) =>
      reject(
        new Error(
          `Couldn't start the local sign-in server on port ${REDIRECT_PORT}: ${(e as Error).message}`,
        ),
      ),
    );
    // Bind without a host so we catch the callback whether the browser resolves
    // localhost to IPv4 (127.0.0.1) or IPv6 (::1) — a common loopback mismatch.
    server.listen(REDIRECT_PORT, () => {
      console.log("\nOpening your browser to sign in as the owner…");
      console.log(`If it doesn't open, paste this into your browser:\n${authUrl}\n`);
      openInBrowser(authUrl);
    });
  });
}

async function browserLogin(auth: ReturnType<typeof makeAuthClient>): Promise<Session> {
  const { data, error } = await auth.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: REDIRECT_URI, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    return fail(`Couldn't start Google sign-in: ${error?.message ?? "no URL returned"}`);
  }

  const code = await waitForCallback(data.url);
  const { data: sess, error: exErr } = await auth.auth.exchangeCodeForSession(code);
  if (exErr || !sess.session) {
    return fail(`Sign-in failed: ${exErr?.message ?? "no session returned"}`);
  }
  return sess.session;
}

async function saveSession(s: Session): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(
    SESSION_FILE,
    JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }),
    { mode: 0o600 },
  );
}

async function clearSession(): Promise<void> {
  await rm(SESSION_FILE, { force: true });
}

/** A still-valid owner session from the cache, or null → do the browser login. */
async function sessionFromCache(auth: ReturnType<typeof makeAuthClient>): Promise<Session | null> {
  let text: string;
  try {
    text = await readFile(SESSION_FILE, "utf8");
  } catch {
    return null;
  }
  const cached = parseSessionCache(text);
  if (!cached) return null;

  if (sessionUsable(cached, Math.floor(Date.now() / 1000))) {
    const { data, error } = await auth.auth.setSession({
      access_token: cached.access_token,
      refresh_token: cached.refresh_token,
    });
    if (!error && data.session) return data.session;
  }
  const { data, error } = await auth.auth.refreshSession({ refresh_token: cached.refresh_token });
  return error ? null : (data.session ?? null);
}

/** Sign in as the owner (from cache if possible, else the browser) before any command. */
async function requireOwnerLogin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!adminEmail) fail("ADMIN_EMAIL (the owner's email) is not set in .env.local.");
  if (!anonKey) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in .env.local.");

  const auth = makeAuthClient(anonKey);

  let session = await sessionFromCache(auth);
  if (!session || !isOwner(session.user?.email, adminEmail)) {
    session = await browserLogin(auth);
    if (!isOwner(session.user?.email, adminEmail)) {
      await clearSession();
      fail(`Signed-in account (${session.user?.email ?? "unknown"}) is not the owner.`);
    }
  }
  await saveSession(session);
  console.log(`✓ Signed in as owner (${adminEmail})`);
}

async function cmdMetrics(): Promise<void> {
  const today = pacificDay();
  const [{ data: usage }, health, users, friends, queued] = await Promise.all([
    db.from("youtube_usage").select("day, units, by_endpoint").order("day", { ascending: false }).limit(7),
    db.rpc("room_health"),
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("friendships").select("requester", { count: "exact", head: true }).eq("status", "accepted"),
    db.from("queue_items").select("id", { count: "exact", head: true }),
  ]);

  const rows = (usage ?? []) as { day: string; units: number; by_endpoint: Record<string, number> }[];
  const todayRow = rows.find((r) => r.day === today);
  const h = ((health.data as { total: number; active: number; stale: number }[] | null) ?? [])[0] ?? {
    total: 0,
    active: 0,
    stale: 0,
  };
  const used = todayRow?.units ?? 0;

  console.log(`\nYouTube quota — ${today} PT`);
  console.log(`  ${used.toLocaleString()} / ${DAILY_QUOTA.toLocaleString()} units  (${Math.round((used / DAILY_QUOTA) * 100)}%)`);
  for (const [ep, u] of Object.entries(todayRow?.by_endpoint ?? {})) {
    console.log(`    ${ep.padEnd(14)} ${u}`);
  }
  console.log(`\n  Last 7 days`);
  for (const r of [...rows].reverse()) {
    console.log(`    ${r.day}  ${String(r.units).padStart(6)} units`);
  }
  console.log(`\nApp`);
  console.log(`  rooms ${h.total}  (active ${h.active}, stale ${h.stale})`);
  console.log(`  users ${users.count ?? 0} / 20 seats   friendships ${friends.count ?? 0}   queued tracks ${queued.count ?? 0}\n`);
}

async function cmdUsers(): Promise<void> {
  const users = await allUsers();
  const ids = users.map((u) => u.id);
  const [{ data: profiles }, { data: participants }] = await Promise.all([
    db.from("profiles").select("id, display_name, username").in("id", ids),
    db.from("room_participants").select("user_id, room_id").in("user_id", ids),
  ]);
  const profById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const roomByUser = new Map((participants ?? []).map((p) => [p.user_id, p.room_id]));

  console.log(`\n${users.length} users\n`);
  console.log(`  ${"email".padEnd(30)} ${"name".padEnd(18)} ${"@handle".padEnd(14)} joined      seen        in a jam`);
  for (const u of users.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))) {
    const p = profById.get(u.id);
    const room = roomByUser.get(u.id);
    console.log(
      `  ${(u.email ?? "—").padEnd(30)} ${(p?.display_name ?? "—").padEnd(18)} ${("@" + (p?.username ?? "—")).padEnd(14)} ${shortDate(u.created_at)}  ${shortDate(u.last_sign_in_at)}  ${room ?? ""}`,
    );
  }
  console.log("");
}

async function cmdUser(email: string): Promise<void> {
  const user = findByEmail(await allUsers(), email);
  if (!user) return fail(`No user with email ${email}.`);
  const [{ data: profile }, { data: participants }, friends] = await Promise.all([
    db.from("profiles").select("display_name, username, avatar_url").eq("id", user.id).maybeSingle(),
    db.from("room_participants").select("room_id").eq("user_id", user.id),
    db.from("friendships").select("requester", { count: "exact", head: true }).eq("status", "accepted").or(`requester.eq.${user.id},addressee.eq.${user.id}`),
  ]);
  console.log(`\n${user.email}`);
  console.log(`  id           ${user.id}`);
  console.log(`  name         ${profile?.display_name ?? "—"}`);
  console.log(`  username     ${profile?.username ? "@" + profile.username : "—"}`);
  console.log(`  joined       ${shortDate(user.created_at)}`);
  console.log(`  last sign-in ${shortDate(user.last_sign_in_at)}`);
  console.log(`  friends      ${friends.count ?? 0}`);
  console.log(`  in rooms     ${(participants ?? []).map((p) => p.room_id).join(", ") || "—"}\n`);
}

/** Every room with its people count, newest first — shared by the list and the picker. */
async function roomChoices(): Promise<RoomChoice[]> {
  const [{ data: rooms }, { data: participants }] = await Promise.all([
    db.from("rooms").select("id, now_playing_title, now_playing_artist, created_at").order("created_at", { ascending: false }),
    db.from("room_participants").select("room_id"),
  ]);
  const counts = new Map<string, number>();
  for (const p of participants ?? []) counts.set(p.room_id, (counts.get(p.room_id) ?? 0) + 1);
  return (rooms ?? []).map((r) => ({
    id: r.id,
    nowPlaying: r.now_playing_title ? `▶ ${r.now_playing_title} — ${r.now_playing_artist ?? ""}` : "idle",
    here: counts.get(r.id) ?? 0,
  }));
}

async function cmdRooms(): Promise<void> {
  const rooms = await roomChoices();
  console.log(`\n${rooms.length} rooms\n`);
  for (const r of rooms) {
    console.log(`  ${r.id.padEnd(12)} ${String(r.here)} here   ${r.nowPlaying}`);
  }
  console.log("");
}

async function cmdSweep(): Promise<void> {
  const { data, error } = await db.rpc("sweep_dead_rooms");
  if (error) return fail(error.message);
  console.log(`Swept ${Number(data ?? 0)} dead room(s).`);
}

async function confirmYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);

/** Arrow-key room picker (raw mode). Resolves the chosen room, or null if cancelled. */
function pickRoom(rooms: RoomChoice[]): Promise<RoomChoice | null> {
  return new Promise((resolve) => {
    let selected = 0;
    const draw = (first: boolean) => {
      if (!first) output.write(`${ESC}[${rooms.length}A`); // cursor up N lines
      output.write(`${ESC}[0J`); // clear from cursor to end of screen
      output.write(renderRoomPicker(rooms, selected) + "\n");
    };
    console.log("\nPick a room to delete — ↑/↓ to move, Enter to select, Esc or q to cancel:\n");
    draw(true);

    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    const done = (choice: RoomChoice | null) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onKey);
      resolve(choice);
    };
    const onKey = (key: string) => {
      if (key === CTRL_C || key === ESC || key === "q") return done(null); // Ctrl-C / Esc / q
      if (key === "\r" || key === "\n") return done(rooms[selected] ?? null); // Enter
      if (key === `${ESC}[A` || key === "k") {
        selected = clampIndex(selected, -1, rooms.length);
        draw(false);
      } else if (key === `${ESC}[B` || key === "j") {
        selected = clampIndex(selected, 1, rooms.length);
        draw(false);
      }
    };
    input.on("data", onKey);
  });
}

async function deleteRoom(roomId: string): Promise<void> {
  const { error } = await db.from("rooms").delete().eq("id", roomId);
  if (error) return fail(error.message);
  console.log(`Deleted room ${roomId}.`);
}

async function cmdRmRoom(code?: string): Promise<void> {
  if (code) {
    const roomId = code.trim();
    const { data: room } = await db
      .from("rooms")
      .select("id, now_playing_title, now_playing_artist")
      .eq("id", roomId)
      .maybeSingle();
    if (!room) return fail(`No room with code ${roomId}.`);
    const { count } = await db
      .from("room_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("room_id", roomId);
    const np = room.now_playing_title
      ? `▶ ${room.now_playing_title} — ${room.now_playing_artist ?? ""}`
      : "idle";
    console.log(`\nAbout to DELETE room ${roomId}:`);
    console.log(`  ${np}   ${count ?? 0} here`);
    console.log(`  → removes the room, its whole queue, and every participant row (cascade).`);
    if (!(await confirm(`\nType the room code to confirm: `, roomId))) {
      return void console.log("Cancelled.");
    }
    return deleteRoom(roomId);
  }

  // No code given → highlight one from a list.
  if (!input.isTTY) return fail("No terminal for the picker — run: june rm-room <code>");
  const rooms = await roomChoices();
  if (rooms.length === 0) return void console.log("No rooms to delete.");
  const chosen = await pickRoom(rooms);
  if (!chosen) return void console.log("Cancelled.");
  console.log(`\nDelete room ${chosen.id} — ${chosen.nowPlaying} (${chosen.here} here)?`);
  console.log("This removes its whole queue and every participant row (cascade).");
  if (!(await confirmYesNo("Delete? [y/N] "))) return void console.log("Cancelled.");
  return deleteRoom(chosen.id);
}

async function cmdRmUser(email: string): Promise<void> {
  const user = findByEmail(await allUsers(), email);
  if (!user) return fail(`No user with email ${email}.`);
  const { data: profile } = await db.from("profiles").select("display_name, username").eq("id", user.id).maybeSingle();

  console.log(`\nAbout to DELETE:`);
  console.log(`  ${user.email}  (${profile?.display_name ?? "no name"}${profile?.username ? " @" + profile.username : ""})`);
  console.log(`  id ${user.id}`);
  console.log(`  → removes profile, friendships, and room memberships (frees a seat);`);
  console.log(`    anonymizes their queued songs and any rooms they host.`);

  if (!(await confirm(`\nType the email to confirm: `, user.email ?? ""))) {
    console.log("Cancelled.");
    return;
  }
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return fail(error.message);
  console.log(`Deleted ${user.email}.`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function usage(): never {
  console.log(
    [
      "june admin — usage (owner browser login required):",
      "  june login              sign in and cache the session",
      "  june logout             clear the cached session",
      "  june metrics            YouTube quota + app stats",
      "  june users              list all users",
      "  june user <email>       one user's detail",
      "  june rooms              list rooms",
      "  june rm-room [code]     delete a room — pick from a list, or pass a code",
      "  june sweep              delete dead rooms now",
      "  june rm-user <email>    delete a user (type-to-confirm)",
      "",
      "(no `june` command yet? run `npm link` once, or use `npm run admin -- <cmd>`)",
    ].join("\n"),
  );
  process.exit(0);
}

const [cmd, arg] = process.argv.slice(2);
const COMMANDS = new Set([
  "login",
  "logout",
  "metrics",
  "users",
  "user",
  "rooms",
  "rm-room",
  "sweep",
  "rm-user",
]);
try {
  if (!cmd || !COMMANDS.has(cmd)) usage();

  if (cmd === "logout") {
    await clearSession();
    console.log("Logged out — cleared the cached session.");
    process.exit(0);
  }

  await requireOwnerLogin();
  if (cmd === "login") process.exit(0);

  switch (cmd) {
    case "metrics":
      await cmdMetrics();
      break;
    case "users":
      await cmdUsers();
      break;
    case "user":
      arg ? await cmdUser(arg) : fail("usage: user <email>");
      break;
    case "rooms":
      await cmdRooms();
      break;
    case "rm-room":
      await cmdRmRoom(arg);
      break;
    case "sweep":
      await cmdSweep();
      break;
    case "rm-user":
      arg ? await cmdRmUser(arg) : fail("usage: rm-user <email>");
      break;
  }
} catch (e) {
  fail(`Error: ${(e as Error).message}`);
}
