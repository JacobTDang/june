import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { KeepListStore } from "./keep-list";
import { check } from "./store";

/** The keep list, read with the service role: library_video_ids() looks
 *  across every user's library, which no user may do. */
export function supabaseKeepListStore(db: SupabaseClient = createServiceClient()): KeepListStore {
  return {
    async libraryVideoIds() {
      const { data, error } = await db.rpc("library_video_ids");
      check("read the keep list", error);
      if (!Array.isArray(data) || !data.every((id) => typeof id === "string")) {
        throw new Error("read the keep list: library_video_ids() didn't return a list of ids");
      }
      return data as string[];
    },
  };
}
