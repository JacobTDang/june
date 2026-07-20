"use client";

import { useState } from "react";
import { updateProfile, uploadAvatar, type MyProfile } from "@/src/lib/profile/actions";
import { Avatar } from "../avatar";

export function ProfileForm({ initial }: { initial: MyProfile }) {
  const [name, setName] = useState(initial.displayName);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [savingName, setSavingName] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setMessage(null);
    try {
      await updateProfile(name);
      setMessage({ kind: "ok", text: "Saved." });
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setSavingName(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the user re-pick the same file after an error
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

      <form className="profile__row" onSubmit={saveName}>
        <label className="profile__label" htmlFor="display-name">
          Display name
        </label>
        <div className="profile__field">
          <input
            id="display-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="What friends see"
          />
          <button type="submit" className="btn btn--primary" disabled={savingName}>
            {savingName ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      {message && (
        <p className={`profile__msg${message.kind === "err" ? " profile__msg--err" : ""}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
