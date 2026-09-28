"use client";

import { useState } from "react";
import { LibraryTab } from "./library-tab";
import { PlaylistsTab } from "./playlists-tab";
import { useAddRunner } from "./runner";
import { SearchTab } from "./search-tab";

type Tab = "search" | "playlist" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "playlist", label: "My playlists" },
  { id: "library", label: "Library" },
];

export function AddMusic({ roomId }: { roomId: string }) {
  const [tab, setTab] = useState<Tab>("search");
  const runner = useAddRunner();

  return (
    <div className="add">
      <div className="eyebrow">Add music</div>

      <div className="add__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`add__tab${tab === t.id ? " add__tab--on" : ""}`}
            onClick={() => {
              setTab(t.id);
              runner.clearMessage();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted and is only hidden, so a search or an open
          playlist survives a trip to another tab. */}
      <div className={tab === "search" ? "add__pane" : "add__pane add__pane--off"}>
        <SearchTab roomId={roomId} runner={runner} />
      </div>
      <div className={tab === "playlist" ? "add__pane" : "add__pane add__pane--off"}>
        <PlaylistsTab roomId={roomId} runner={runner} />
      </div>
      <div className={tab === "library" ? "add__pane" : "add__pane add__pane--off"}>
        <LibraryTab roomId={roomId} runner={runner} active={tab === "library"} />
      </div>

      {runner.message && <p className="add__msg">{runner.message}</p>}
    </div>
  );
}
