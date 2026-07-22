import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * A Supabase client authenticated with the service role key. It bypasses RLS,
 * so use it ONLY for trusted server-side writes that no user should be able to
 * forge - here, populating the shared metadata caches. Never make authorization
 * decisions with it, and never import it into client code (the `server-only`
 * guard turns any such import into a build error).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role is not configured (SUPABASE_SERVICE_ROLE_KEY).");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
