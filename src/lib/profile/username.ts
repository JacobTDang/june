export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

/** Handles that collide with routes or invite impersonation. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "root",
  "support",
  "help",
  "about",
  "api",
  "u",
  "user",
  "users",
  "me",
  "profile",
  "profiles",
  "friend",
  "friends",
  "room",
  "rooms",
  "jam",
  "jams",
  "auth",
  "login",
  "logout",
  "signin",
  "signout",
  "settings",
  "june",
  "official",
  "null",
  "undefined",
]);

export type UsernameCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Normalize and validate a username: lowercased, 3–20 chars, must start with a
 * letter, only letters/digits/underscore, not a reserved word. Returns the
 * canonical value or a specific error (used for both live checks and saving).
 */
export function normalizeUsername(input: string): UsernameCheck {
  const value = input.trim().toLowerCase();

  if (value.length < USERNAME_MIN) return { ok: false, error: `At least ${USERNAME_MIN} characters.` };
  if (value.length > USERNAME_MAX) return { ok: false, error: `At most ${USERNAME_MAX} characters.` };
  if (!/^[a-z]/.test(value)) return { ok: false, error: "Must start with a letter." };
  if (!USERNAME_RE.test(value)) {
    return { ok: false, error: "Only letters, numbers, and underscores." };
  }
  if (RESERVED.has(value)) return { ok: false, error: "That username isn't available." };

  return { ok: true, value };
}
