import { describe, expect, it } from "vitest";
import { resolveSignupCap, DEFAULT_SIGNUP_CAP } from "../../src/lib/auth/signup-cap";

describe("resolveSignupCap", () => {
  it("uses a valid positive integer from the env", () => {
    expect(resolveSignupCap("50")).toBe(50);
  });

  it("floors a fractional value", () => {
    expect(resolveSignupCap("20.9")).toBe(20);
  });

  it("falls back to the default when unset", () => {
    expect(resolveSignupCap(undefined)).toBe(DEFAULT_SIGNUP_CAP);
  });

  it("falls back to the default for non-numeric or non-positive values", () => {
    expect(resolveSignupCap("abc")).toBe(DEFAULT_SIGNUP_CAP);
    expect(resolveSignupCap("0")).toBe(DEFAULT_SIGNUP_CAP);
    expect(resolveSignupCap("-5")).toBe(DEFAULT_SIGNUP_CAP);
    expect(resolveSignupCap("")).toBe(DEFAULT_SIGNUP_CAP);
  });

  it("defaults to 20", () => {
    expect(DEFAULT_SIGNUP_CAP).toBe(20);
  });
});
