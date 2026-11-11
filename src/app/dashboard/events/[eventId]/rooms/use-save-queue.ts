"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { setPending, useLeaveGuard } from "@/components/pending-edits";
import type { SaveStatus } from "./save-footer";

export type RunResult = SaveStatus | { kind: "conflict" } | { kind: "nothing" };

/**
 * Saving as you go (lessons L3 and L18): a moment after each change the editor's `run` sends what's changed. One
 * save at a time; a change made while one is on its way goes in the next. While anything is waiting or failed,
 * leaving the page asks first. A co-host's save in between ("conflict") waits for the organizer's choice.
 */
export function useSaveQueue(run: () => Promise<RunResult>, what: string) {
  const key = useId();
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const again = useRef(false);
  const runRef = useRef(run);
  const fireAgain = useRef<(() => void) | null>(null);
  useEffect(() => {
    runRef.current = run;
  });
  useLeaveGuard(what);
  useEffect(() => () => setPending(key, null), [key]);

  const fire = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setPending(key, { kind: "saving" });
    setStatus({ kind: "saving" });
    let r: RunResult;
    try {
      r = await runRef.current();
    } catch {
      r = { kind: "failed", error: "Check your connection, then select Retry.", retry: true };
    }
    busy.current = false;
    if (again.current) {
      again.current = false;
      fireAgain.current?.();
      return;
    }
    if (r.kind === "conflict") {
      setPending(key, { kind: "failed" });
      setStatus({ kind: "idle" });
    } else if (r.kind === "nothing") {
      setPending(key, null);
      setStatus((s) => (s.kind === "saving" ? { kind: "idle" } : s));
    } else {
      setPending(key, r.kind === "failed" ? { kind: "failed", flush: r.retry ? () => fireAgain.current?.() : undefined } : r.kind === "incomplete" ? { kind: "incomplete" } : null);
      setStatus(r);
    }
  }, [key]);
  useEffect(() => {
    fireAgain.current = () => void fire();
  }, [fire]);

  /** A change: save it in a moment. */
  const queue = useCallback(
    (now = false) => {
      if (timer.current) clearTimeout(timer.current);
      setPending(key, { kind: "saving", flush: () => void fire() });
      timer.current = setTimeout(() => void fire(), now ? 0 : 900);
    },
    [fire, key],
  );

  /** Something's waiting that leaving would lose (a posted change not saved yet), or nothing. */
  const hold = useCallback((on: boolean) => setPending(`${key}-held`, on ? { kind: "unadded" } : null), [key]);
  useEffect(() => () => setPending(`${key}-held`, null), [key]);

  /** A co-host's save was dealt with: nothing waits any more. */
  const clear = useCallback(() => setPending(key, null), [key]);

  return { status, setStatus, queue, fire, hold, clear };
}
