"use server";

import sharp from "sharp";
import { createClient } from "../supabase/server";
import { normalizeDisplayName, resolveDisplayName } from "./display-name";
import { normalizeUsername } from "./username";
import {
  AVATAR_SIZE,
  avatarObjectPath,
  avatarUrlWithCacheBust,
  validateAvatarFile,
} from "./avatar";

const AVATARS_BUCKET = "avatars";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return { supabase, user };
}

export type MyProfile = { displayName: string; avatarUrl: string | null; username: string | null };

/** The signed-in user's profile, seeding a row from their Google identity on first access. */
export async function getMyProfile(): Promise<MyProfile> {
  const { supabase, user } = await requireUser();

  const { data: row } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, username")
    .eq("id", user.id)
    .maybeSingle();

  if (!row) {
    const seeded = resolveDisplayName(null, user);
    // Insert-if-missing; a concurrent first access just no-ops.
    await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: seeded }, { onConflict: "id", ignoreDuplicates: true });
    return { displayName: seeded, avatarUrl: null, username: null };
  }

  const r = row as { display_name: string | null; avatar_url: string | null; username: string | null };
  return {
    displayName: resolveDisplayName(r.display_name, user),
    avatarUrl: r.avatar_url,
    username: r.username,
  };
}

export type UsernameAvailability =
  | { available: true; value: string }
  | { available: false; error: string };

/** Whether a username is valid and free (excluding your own). For live feedback. */
export async function checkUsernameAvailable(input: string): Promise<UsernameAvailability> {
  const norm = normalizeUsername(input);
  if (!norm.ok) return { available: false, error: norm.error };

  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", norm.value)
    .neq("id", user.id)
    .maybeSingle();

  if (data) return { available: false, error: "That username is taken." };
  return { available: true, value: norm.value };
}

/** Save display name and (optionally) username. Throws on invalid input or a clash. */
export async function updateProfile(input: {
  displayName: string;
  username?: string | null;
}): Promise<void> {
  const { supabase, user } = await requireUser();

  const patch: Record<string, unknown> = {
    id: user.id,
    display_name: normalizeDisplayName(input.displayName),
    updated_at: new Date().toISOString(),
  };

  if (input.username !== undefined) {
    const raw = (input.username ?? "").trim();
    if (raw === "") {
      patch.username = null;
    } else {
      const norm = normalizeUsername(raw);
      if (!norm.ok) throw new Error(norm.error);
      patch.username = norm.value;
    }
  }

  const { error } = await supabase.from("profiles").upsert(patch, { onConflict: "id" });
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new Error("That username is taken.");
    throw new Error(`Couldn't save your profile: ${error.message}`);
  }
}

/**
 * Process and store an uploaded avatar. sharp decodes the image (incl. HEIC),
 * honors EXIF orientation, then re-encodes to a small square WebP — which also
 * strips metadata and neutralizes malicious/oversized inputs. Overwrites the
 * user's single avatar object; the stored URL is cache-busted so the new image
 * isn't masked by a stale cache.
 */
export async function uploadAvatar(formData: FormData): Promise<{ avatarUrl: string }> {
  const { supabase, user } = await requireUser();

  const file = formData.get("avatar");
  if (!(file instanceof File)) throw new Error("No image was provided.");

  const check = validateAvatarFile({ size: file.size, type: file.type });
  if (!check.ok) throw new Error(check.error);

  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new Error("Couldn't read that image — try a JPG or PNG.");
  }

  const path = avatarObjectPath(user.id);
  const { error: upErr } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, webp, { contentType: "image/webp", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data: pub } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  const avatarUrl = avatarUrlWithCacheBust(pub.publicUrl, Date.now());

  const { error: dbErr } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, avatar_url: avatarUrl, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
  if (dbErr) throw new Error(`Couldn't save your avatar: ${dbErr.message}`);

  return { avatarUrl };
}
