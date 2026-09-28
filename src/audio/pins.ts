import { z } from "zod";
import { createServiceRequest, type ServiceConfig } from "./service-request";

/**
 * mp3server's keep list, called from june's server with the service token:
 * the video ids whose audio is kept at home and fetched ahead of time.
 */

const pinsReplacedSchema = z.object({
  count: z.number().int(),
  added: z.number().int(),
  removed: z.number().int(),
});

export type PinsReplaced = z.infer<typeof pinsReplacedSchema>;

export interface PinService {
  /** Replaces the whole set; ids that leave it lose their pin. */
  replacePins(videoIds: readonly string[]): Promise<PinsReplaced>;
}

export function createPinService(config: ServiceConfig): PinService {
  const request = createServiceRequest(config, "createPinService");

  return {
    async replacePins(videoIds) {
      const response = await request.send("PUT", "/pins", { video_ids: videoIds });
      if (!response.ok) return request.fail("/pins", response);
      return pinsReplacedSchema.parse(await response.json());
    },
  };
}
