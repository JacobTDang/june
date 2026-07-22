/** Raw upload size cap, checked before we hand bytes to sharp (bounds memory). */
export const MAX_AVATAR_BYTES = 6 * 1024 * 1024;
/** Output avatar is a square of this many pixels. */
export const AVATAR_SIZE = 256;

export type UploadCheck = { ok: true } | { ok: false; error: string };

/**
 * Coarse pre-validation before decoding: reject empty, oversized, or obviously
 * non-image uploads. sharp does the real validation by decoding - an empty
 * content-type is allowed through because some pickers omit it.
 */
export function validateAvatarFile(file: { size: number; type: string }): UploadCheck {
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: "Image must be 6 MB or smaller." };
  }
  if (file.type && !file.type.startsWith("image/")) {
    return { ok: false, error: "Please choose an image file." };
  }
  return { ok: true };
}

/** Storage object key for a user's avatar. `userId` must come from auth, never client input. */
export function avatarObjectPath(userId: string): string {
  return `${userId}/avatar.webp`;
}

/**
 * Append a version query so a re-uploaded avatar (which reuses the same storage
 * path) is fetched fresh instead of served from a stale browser/CDN cache.
 */
export function avatarUrlWithCacheBust(publicUrl: string, version: number | string): string {
  const sep = publicUrl.includes("?") ? "&" : "?";
  return `${publicUrl}${sep}v=${version}`;
}
