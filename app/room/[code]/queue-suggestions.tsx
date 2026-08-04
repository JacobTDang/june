"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { addCandidate } from "@/src/lib/room/add-music";
import { suggestForRoom } from "@/src/lib/room/history";
import type { Suggestable } from "@/src/lib/room/suggest";

/**
 * What to play next, when the queue has run dry.
 *
 * Drawn from what this room's listeners have actually played — so it says
 * something about the people in the room rather than about a chart. Renders
 * the plain empty state until suggestions arrive, and stays with it when there
 * is no history to draw on yet.
 */
export function QueueSuggestions({ roomId }: { roomId: string }) {
  const [suggestions, setSuggestions] = useState<Suggestable[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void suggestForRoom(roomId, 3)
      .then((picks) => {
        if (alive) setSuggestions(picks);
      })
      .catch(() => {
        // A suggestion that fails to load is not worth a message; the empty
        // queue state below already says everything necessary.
      });
    return () => {
      alive = false;
    };
  }, [roomId]);

  if (suggestions.length === 0) return <p className="muted">Nothing queued yet.</p>;

  return (
    <div className="suggest">
      <p className="muted suggest__lead">Nothing queued. More like what you&rsquo;ve played:</p>
      <ul className="suggest__list">
        {suggestions.map((s) => (
          <li key={s.sourceId} className="suggest__item">
            <div className="suggest__meta">
              <span className="suggest__title">{s.title}</span>
              <span className="suggest__artist">{s.artist}</span>
            </div>
            <button
              className="add__btn"
              disabled={busy}
              aria-label={`Add ${s.title}`}
              onClick={() => {
                setBusy(true);
                void addCandidate(roomId, s)
                  .then(() => setSuggestions((rest) => rest.filter((x) => x.sourceId !== s.sourceId)))
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              <Plus size={16} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
