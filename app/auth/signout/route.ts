import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete(PROVIDER_TOKEN_COOKIE);
  return response;
}
