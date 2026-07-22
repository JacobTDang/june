/**
 * Merge username-matched and display-name-matched profile rows into one list:
 * username matches first, deduped by id, capped at `limit`. Pure and
 * import-clean so it's unit-testable.
 */
export function mergeSearchResults<T extends { id: string }>(
  byUsername: T[],
  byName: T[],
  limit = 10,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of [...byUsername, ...byName]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
