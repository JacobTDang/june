import { describe, expect, it } from "vitest";
import { isAdminIdentity } from "../../src/lib/metrics/admin-identity";

const ADMIN = "owner@example.com";
const confirmed = (email: string | null) => ({ email, emailConfirmed: true });

describe("isAdminIdentity", () => {
  it("accepts the configured owner with a confirmed email", () => {
    expect(isAdminIdentity(confirmed(ADMIN), ADMIN)).toBe(true);
  });

  it("is case- and whitespace-insensitive on both sides", () => {
    expect(isAdminIdentity(confirmed("Owner@Example.com"), `  ${ADMIN.toUpperCase()}  `)).toBe(true);
  });

  it("rejects an unverified email even if it matches the owner", () => {
    // The core hardening: never trust an email string that isn't provider-verified.
    expect(isAdminIdentity({ email: ADMIN, emailConfirmed: false }, ADMIN)).toBe(false);
  });

  it("rejects a different email", () => {
    expect(isAdminIdentity(confirmed("someone@else.com"), ADMIN)).toBe(false);
  });

  it("rejects when no admin email is configured", () => {
    expect(isAdminIdentity(confirmed(ADMIN), undefined)).toBe(false);
    expect(isAdminIdentity(confirmed(ADMIN), "")).toBe(false);
    expect(isAdminIdentity(confirmed(ADMIN), "   ")).toBe(false);
  });

  it("rejects a signed-out user or one with no email", () => {
    expect(isAdminIdentity(null, ADMIN)).toBe(false);
    expect(isAdminIdentity(confirmed(null), ADMIN)).toBe(false);
  });
});
