/**
 * The calendar date in America/Los_Angeles as `YYYY-MM-DD`. YouTube's daily
 * quota resets at midnight Pacific, so usage is bucketed by the Pacific day.
 */
export function pacificDay(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
