/**
 * Cap provider/client-supplied track text so a hostile or malformed value can't
 * bloat a row or break the room layout. Titles and artists are display strings;
 * 200 chars is far more than any real one needs. Pure and import-clean.
 */
export function clampText(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}
