/**
 * How many people may hold a seat in the app. A soft cap while it's new; change
 * it any time via the `SIGNUP_CAP` env var. Import-clean so it's unit-testable.
 */
export const DEFAULT_SIGNUP_CAP = 20;

export function resolveSignupCap(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SIGNUP_CAP;
}
