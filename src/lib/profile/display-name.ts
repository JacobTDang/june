export const MAX_DISPLAY_NAME = 40;

export type GoogleUser = {
  email?: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * The name to show for a user: their chosen profile name if set, otherwise the
 * name Google gave us, then their email, then a generic fallback.
 */
export function resolveDisplayName(
  profileName: string | null | undefined,
  user: GoogleUser,
): string {
  const chosen = profileName?.trim();
  if (chosen) return chosen;

  const meta = user.user_metadata ?? {};
  return (
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user.email ??
    "Guest"
  );
}

/**
 * Validate and normalize a user-submitted display name. Throws (fail loud) on an
 * empty or over-long name rather than silently trimming to nothing.
 */
export function normalizeDisplayName(input: string): string {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new Error("Display name can't be empty.");
  if (name.length > MAX_DISPLAY_NAME) {
    throw new Error(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
  }
  return name;
}
