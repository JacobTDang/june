/**
 * A user avatar: the uploaded image if there is one, otherwise a flat
 * rounded-square with their initial. Presentational — safe in server or client
 * components.
 */
export function Avatar({
  name,
  url,
  size = 36,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="avatar-img"
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {(name?.[0] ?? "?").toUpperCase()}
    </span>
  );
}
