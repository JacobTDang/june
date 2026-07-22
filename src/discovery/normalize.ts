/**
 * Clean up a raw search term before it hits the iTunes API: collapse
 * whitespace and strip the "official video" / "lyrics" style noise people
 * paste in from elsewhere, which otherwise pushes the real studio track down
 * the results. iTunes' own matching handles minor misspellings, so this only
 * removes noise - it does not attempt spell-correction.
 *
 * Pure and import-clean (no server-only deps) so it can be unit-tested directly.
 */

// Matched case-insensitively as whole tokens/phrases. Order matters: the
// multi-word phrases must run before the single "video"/"lyrics" tokens.
const NOISE_PATTERNS: RegExp[] = [
  /\bofficial\s+music\s+video\b/gi,
  /\bofficial\s+video\b/gi,
  /\bofficial\s+audio\b/gi,
  /\blyric\s+video\b/gi,
  /\blyrics?\b/gi,
  /\bhd\b/gi,
  /\bhq\b/gi,
  /\bm\/?v\b/gi,
];

export function normalizeQuery(raw: string): string {
  let s = raw;
  for (const re of NOISE_PATTERNS) s = s.replace(re, " ");

  // Drop brackets/parens left empty by the removals above.
  s = s.replace(/[([{]\s*[)\]}]/g, " ");

  // Collapse whitespace, then trim stray leading/trailing separators.
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[-–—([{|\s]+|[-–—)\]}|\s]+$/g, "").trim();

  const collapsedOriginal = raw.replace(/\s+/g, " ").trim();
  return s === "" ? collapsedOriginal : s;
}
