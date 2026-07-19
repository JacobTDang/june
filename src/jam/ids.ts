import { randomUUID } from "node:crypto";

/** Generate a unique id for a jam, participant, or track. */
export function newId(): string {
  return randomUUID();
}
