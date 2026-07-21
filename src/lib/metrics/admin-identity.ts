export type AdminIdentity = { email: string | null; emailConfirmed: boolean };

/**
 * Pure owner check. Requires the email to be provider-verified: an unconfirmed
 * email must never satisfy the gate, so enabling a non-verifying auth method
 * (e.g. email/password) can't let someone register the owner's address and walk
 * into /metrics. Kept free of server-only imports so it can be unit-tested.
 */
export function isAdminIdentity(
  user: AdminIdentity | null,
  adminEmail: string | undefined,
): boolean {
  const admin = adminEmail?.trim().toLowerCase();
  if (!admin || !user?.email || !user.emailConfirmed) return false;
  return user.email.toLowerCase() === admin;
}
