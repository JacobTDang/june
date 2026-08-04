/** A line about yourself, shown on /u/<handle>. Kept out of actions.ts because
 *  a "use server" module may only export async functions — and because the
 *  rule is worth testing on its own, like display names and usernames. */

/** Matches the profiles_bio_length check constraint. */
export const MAX_BIO = 160;

/**
 * The bio as it should be stored, or null for an empty one. Collapses runs of
 * whitespace (including the newlines a textarea invites) so a bio can't be
 * padded into a wall of blank lines on someone's profile.
 */
export function normalizeBio(input: string): string | null {
  const bio = input.trim().replace(/\s+/g, " ");
  if (bio.length === 0) return null;
  if (bio.length > MAX_BIO) {
    throw new Error(`Bio must be ${MAX_BIO} characters or fewer.`);
  }
  return bio;
}
