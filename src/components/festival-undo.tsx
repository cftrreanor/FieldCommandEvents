"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-state";

/** How long Undo stays after a tap. */
const UNDO_SECONDS = 10;

type Done = { text: string; undo: (() => Promise<ActionState>) | null };

/**
 * Festivals on the day: run a tap, refresh the page, and offer Undo for about 10 seconds, announced politely
 * (role="status"). Used by Event day, a room's page, and the door page. `busy` names the tap in progress, so its
 * button can say "Saving…" and the others wait.
 */
export function useTaps() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), UNDO_SECONDS * 1000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(
    async (key: string, act: () => Promise<ActionState>, text: string, undo: (() => Promise<ActionState>) | null) => {
      setBusy(key);
      setError(null);
      const r = await act().catch(() => ({ error: "Check your connection, then try again." }) as ActionState);
      setBusy(null);
      if (r.error) {
        setError(r.error);
        setDone(null);
        return;
      }
      setDone({ text, undo });
      clear();
      startTransition(() => router.refresh());
    },
    [clear, router],
  );

  const undoNow = useCallback(async () => {
    if (!done?.undo) return;
    const undo = done.undo;
    setBusy("undo");
    const r = await undo().catch(() => ({ error: "Check your connection, then try again." }) as ActionState);
    setBusy(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    setDone({ text: `Undone: ${done.text.charAt(0).toLowerCase()}${done.text.slice(1)}`, undo: null });
    clear();
    startTransition(() => router.refresh());
  }, [clear, done, router]);

  const bar = (
    <div className="space-y-2">
      {/* Always in the page, so screen readers hear each change. */}
      <div role="status" aria-live="polite">
        {done && (
          <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-brand-soft px-4 py-1.5 text-sm ring-1 ring-brand/25">
            <span>{done.text}</span>
            {done.undo && (
              <button
                type="button"
                onClick={() => void undoNow()}
                disabled={busy !== null}
                className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4 disabled:opacity-60"
              >
                {busy === "undo" ? "Undoing…" : "Undo"}
              </button>
            )}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>
          {error}
        </p>
      )}
    </div>
  );

  return { busy, run, bar };
}
