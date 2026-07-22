"use client";

import { useEffect, useState } from "react";
import {
  checkUsernameAvailable,
  updateProfile,
  uploadAvatar,
  type MyProfile,
} from "@/src/lib/profile/actions";
import { Avatar } from "../avatar";

type Availability = { status: "idle" | "checking" | "ok" | "error"; message?: string };

export function ProfileForm({ initial }: { initial: MyProfile }) {
  const [name, setName] = useState(initial.displayName);
  const [username, setUsername] = useState(initial.username ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [availability, setAvailability] = useState<Availability>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Debounced username availability check.
  useEffect(() => {
    const value = username.trim();
    if (value === "" || value === (initial.username ?? "")) {
      setAvailability({ status: "idle" });
      return;
    }
    setAvailability({ status: "checking" });
    const t = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailable(value);
        setAvailability(
          res.available
            ? { status: "ok", message: "Available" }
            : { status: "error", message: res.error },
        );
      } catch {
        setAvailability({ status: "idle" });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [username, initial.username]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ displayName: name, username });
      setMessage({ kind: "ok", text: "Saved." });
      setAvailability({ status: "idle" });
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("avatar", file);
      const result = await uploadAvatar(fd);
      setAvatarUrl(result.avatarUrl);
      setMessage({ kind: "ok", text: "Photo updated." });
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="profile">
      <div className="profile__avatar">
        <Avatar name={name} url={avatarUrl} size={96} />
        <label className="btn btn--sm">
          {uploading ? "Uploading…" : "Change photo"}
          <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} hidden />
        </label>
      </div>

      <form className="profile__form" onSubmit={saveProfile}>
        <div>
          <label className="profile__label" htmlFor="display-name">
            Display name
          </label>
          <input
            id="display-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="What friends see"
          />
        </div>

        <div>
          <label className="profile__label" htmlFor="username">
            Username
          </label>
          <div className="profile__handle">
            <span className="profile__at" aria-hidden="true">
              @
            </span>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="username"
            />
          </div>
          {availability.status !== "idle" && (
            <span className={`profile__hint profile__hint--${availability.status}`}>
              {availability.status === "checking" ? "Checking…" : availability.message}
            </span>
          )}
          <span className="profile__label" style={{ marginTop: "0.4rem" }}>
            Lets friends find you and share your link.
          </span>
        </div>

        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving || availability.status === "error"}
          style={{ alignSelf: "flex-start" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      {message && (
        <p className={`profile__msg${message.kind === "err" ? " profile__msg--err" : ""}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
