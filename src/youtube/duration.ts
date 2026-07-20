/**
 * Parse an ISO 8601 duration (e.g. "PT3M20S") into whole milliseconds.
 *
 * This targets the *media* durations returned by the YouTube Data API's
 * `contentDetails.duration`. It supports weeks, days, hours, minutes and
 * seconds, each of which may carry a decimal fraction (result is rounded to
 * the nearest millisecond). It deliberately rejects years and calendar
 * months — whose length in milliseconds is undefined — as well as negative or
 * malformed input, throwing rather than silently guessing.
 */

const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
} as const;

const WEEKS_RE = /^P(\d+(?:[.,]\d+)?)W$/;
const DATE_TIME_RE =
  /^P(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/;

const toNumber = (value: string): number => Number(value.replace(",", "."));

export function parseIso8601Duration(input: string): number {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(
      `parseIso8601Duration: expected a non-empty string, got ${JSON.stringify(input)}`,
    );
  }
  if (input.startsWith("-")) {
    throw new Error(
      `parseIso8601Duration: negative durations are not supported: "${input}"`,
    );
  }
  // A "Y" anywhere, or an "M" in the date portion (before any "T"), denotes
  // years or calendar months, which have no fixed length in milliseconds.
  if (/\d+(?:[.,]\d+)?Y/.test(input) || /^P[^T]*\d+(?:[.,]\d+)?M/.test(input)) {
    throw new Error(
      `parseIso8601Duration: years and calendar months are not supported: "${input}"`,
    );
  }

  const weeks = WEEKS_RE.exec(input);
  if (weeks) return Math.round(toNumber(weeks[1]!) * MS.week);

  const match = DATE_TIME_RE.exec(input);
  if (!match) {
    throw new Error(
      `parseIso8601Duration: malformed ISO 8601 duration: "${input}"`,
    );
  }

  const [, days, hours, minutes, seconds] = match;
  if (
    days === undefined &&
    hours === undefined &&
    minutes === undefined &&
    seconds === undefined
  ) {
    throw new Error(
      `parseIso8601Duration: duration has no components: "${input}"`,
    );
  }

  const total =
    (days !== undefined ? toNumber(days) * MS.day : 0) +
    (hours !== undefined ? toNumber(hours) * MS.hour : 0) +
    (minutes !== undefined ? toNumber(minutes) * MS.minute : 0) +
    (seconds !== undefined ? toNumber(seconds) * MS.second : 0);

  return Math.round(total);
}
