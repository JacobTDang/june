"use client";

import { useCallback, useState } from "react";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; notice: string };

/** Unwrap a server action's result, throwing its notice so `run` shows it. A
 *  client-side throw isn't redacted the way the server's raw error would be. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.notice);
  return result.data;
}

export interface AddRunner {
  busy: boolean;
  run<T>(fn: () => Promise<T>, ok?: (result: T) => string): void;
}

/** The panel's one busy flag and one message line, shared by every tab, so
 *  a slow add in one tab can't be started twice from another. */
export function useAddRunner(): AddRunner & { message: string | null; clearMessage: () => void } {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(<T>(fn: () => Promise<T>, ok?: (result: T) => string) => {
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await fn();
        if (ok) setMessage(ok(result));
      } catch (e) {
        setMessage((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const clearMessage = useCallback(() => setMessage(null), []);
  return { busy, message, clearMessage, run };
}
