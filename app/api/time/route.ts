export const dynamic = "force-dynamic";

/** Server clock, for the client-side offset handshake. */
export async function GET() {
  return Response.json({ now: Date.now() });
}
