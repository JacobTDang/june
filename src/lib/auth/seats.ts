import "server-only";
import { createServiceClient } from "../supabase/service";
import { resolveSignupCap } from "./signup-cap";

/** Max seats in the app. Change via the `SIGNUP_CAP` env var (default 20). */
export const SIGNUP_CAP = resolveSignupCap(process.env.SIGNUP_CAP);

/**
 * Admit a user if a seat is free - or they already hold one. Returns false when
 * the app is full. Uses the service role and the trusted server-side cap, so a
 * client can't call the underlying function with a fake limit.
 */
export async function claimSeat(userId: string): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.rpc("claim_seat", {
    p_user: userId,
    p_max: SIGNUP_CAP,
  });
  if (error) throw new Error(`Seat claim failed: ${error.message}`);
  return Boolean(data);
}

/** Remove an account that couldn't be admitted, so the cap count stays exact. */
export async function removeUnseatedUser(userId: string): Promise<void> {
  const service = createServiceClient();
  await service.auth.admin.deleteUser(userId);
}
