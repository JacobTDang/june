import { timingSafeEqual } from "node:crypto";

/** Whether an Authorization header is exactly `Bearer <secret>`, compared in
 *  constant time so the secret can't be recovered by timing the answer. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret) throw new Error("bearerMatches: secret is empty");
  if (header === null) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
