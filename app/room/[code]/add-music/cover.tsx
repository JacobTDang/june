import { Music } from "lucide-react";

/** A consistently framed cover thumbnail, with a music-note fallback. */
export function Cover({ url }: { url?: string | null }) {
  return (
    <div className="add__cover">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" />
      ) : (
        <Music size={16} />
      )}
    </div>
  );
}
