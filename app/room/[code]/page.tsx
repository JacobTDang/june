import { redirect } from "next/navigation";
import { createClient } from "@/src/lib/supabase/server";
import { getRoomState, joinRoom } from "@/src/lib/room/actions";
import { Room } from "./room";

function displayNameOf(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}): string {
  const meta = user.user_metadata ?? {};
  return (
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    user.email ??
    "Guest"
  );
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Not signed in? Send them to sign in, remembering this room so they land
  // back here (and auto-join) afterward — that's what makes invite links work.
  if (!user) redirect(`/?next=${encodeURIComponent(`/room/${code}`)}`);

  const exists = await getRoomState(code);
  if (!exists) {
    return (
      <main className="container">
        <p className="muted">
          Room <strong>{code}</strong> doesn&apos;t exist. <a href="/">Go home</a>.
        </p>
      </main>
    );
  }

  const name = displayNameOf(user);
  await joinRoom(code, name);
  const state = (await getRoomState(code)) ?? exists;

  return <Room initial={state} me={{ userId: user.id, name }} />;
}
