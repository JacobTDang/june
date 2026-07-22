"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/src/lib/metrics/admin";
import { sweepDeadRooms } from "@/src/lib/room/cleanup";

/** Owner-only: delete abandoned rooms (and their queues/participants). */
export async function cleanupDeadRoomsAction(_formData: FormData): Promise<void> {
  if (!(await isAdmin())) throw new Error("Not authorized.");
  await sweepDeadRooms();
  revalidatePath("/metrics");
}
