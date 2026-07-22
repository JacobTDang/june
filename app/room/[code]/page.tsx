import { redirect } from "next/navigation";
import { enterRoom } from "@/src/lib/room/actions";
import { Room } from "./room";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const result = await enterRoom(code);

  // Not signed in? Send them to sign in, remembering this room so they land
  // back here (and auto-join) afterward - that's what makes invite links work.
  if (result.status === "unauthenticated") {
    redirect(`/?next=${encodeURIComponent(`/room/${code}`)}`);
  }

  if (result.status === "not_found") {
    return (
      <main className="container">
        <p className="muted">
          Room <strong>{code}</strong> doesn&apos;t exist. <a href="/">Go home</a>.
        </p>
      </main>
    );
  }

  return <Room initial={result.state} me={result.me} />;
}
