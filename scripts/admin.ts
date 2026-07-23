/**
 * june admin CLI — owner-only ops from your machine, using the service-role key.
 * No web auth, no owner gate: having SUPABASE_SERVICE_ROLE_KEY is the credential.
 *
 *   npm run admin -- metrics
 *   npm run admin -- users
 *   npm run admin -- user <email>
 *   npm run admin -- rooms
 *   npm run admin -- sweep
 *   npm run admin -- rm-user <email>
 *
 * Run via `npm run admin` (loads .env.local). Never deploy this.
 */
import { createClient, type User } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run via `npm run admin` so .env.local loads.",
  );
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

/**
 * Verify the operator is the owner (ADMIN_EMAIL) by email OTP before any command
 * runs. Note: the service-role key in .env.local is the real credential — this
 * is a deliberate owner-login gate, not a wall against whoever holds that file.
 */
async function requireOwnerLogin(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!adminEmail) fail("ADMIN_EMAIL (the owner's email) is not set in .env.local.");
  if (!anonKey) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set in .env.local.");

  const auth = createClient(url!, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { error: sendErr } = await auth.auth.signInWithOtp({
    email: adminEmail,
    options: { shouldCreateUser: false },
  });
  if (sendErr) fail(`Couldn't send a login code: ${sendErr.message}`);
  console.log(`\nA 6-digit login code was sent to ${adminEmail}.`);

  const rl = createInterface({ input, output });
  const code = (await rl.question("Enter the code: ")).trim();
  rl.close();

  const { data, error } = await auth.auth.verifyOtp({ email: adminEmail, token: code, type: "email" });
  if (error) fail(`Login failed: ${error.message}`);
  if ((data.user?.email ?? "").toLowerCase() !== adminEmail.toLowerCase()) {
    fail("Signed-in account is not the owner.");
  }
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

async function cmdRooms(): Promise<void> {
  const [{ data: rooms }, { data: participants }] = await Promise.all([
    db.from("rooms").select("id, now_playing_title, now_playing_artist, created_at").order("created_at", { ascending: false }),
    db.from("room_participants").select("room_id"),
  ]);
  const counts = new Map<string, number>();
  for (const p of participants ?? []) counts.set(p.room_id, (counts.get(p.room_id) ?? 0) + 1);

  console.log(`\n${(rooms ?? []).length} rooms\n`);
  for (const r of rooms ?? []) {
    const np = r.now_playing_title ? `▶ ${r.now_playing_title} — ${r.now_playing_artist ?? ""}` : "idle";
    console.log(`  ${r.id.padEnd(12)} ${String(counts.get(r.id) ?? 0)} here   ${np}`);
  }
  console.log("");
}

async function cmdSweep(): Promise<void> {
  const { data, error } = await db.rpc("sweep_dead_rooms");
  if (error) return fail(error.message);
  console.log(`Swept ${Number(data ?? 0)} dead room(s).`);
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
      "june admin — usage (owner login required):",
      "  npm run admin -- metrics            YouTube quota + app stats",
      "  npm run admin -- users              list all users",
      "  npm run admin -- user <email>       one user's detail",
      "  npm run admin -- rooms              list rooms",
      "  npm run admin -- sweep              delete dead rooms now",
      "  npm run admin -- rm-user <email>    delete a user (type-to-confirm)",
    ].join("\n"),
  );
  process.exit(0);
}

const [cmd, arg] = process.argv.slice(2);
const COMMANDS = new Set(["metrics", "users", "user", "rooms", "sweep", "rm-user"]);
try {
  if (!cmd || !COMMANDS.has(cmd)) usage();

  await requireOwnerLogin();

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
