import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase client for server code (Server Components, Route Handlers). */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Setting cookies from a Server Component throws; that's expected -
            // the middleware refreshes the session, so this is a safe no-op here.
          }
        },
      },
    },
  );
}
