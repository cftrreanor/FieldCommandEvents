"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-state";

export type StopRow = {
  id: string;
  name: string;
  href: string;
  /** "Parking · Due 60 minutes before warm-up". */
  detail: string;
  /** What it still needs before contest day ("Needs a shift", "Needs a Coordinator"), or null. */
  needs: string | null;
  up?: () => Promise<ActionState>;
  down?: () => Promise<ActionState>;
};

const ARROW =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border-[1.5px] border-field-border bg-surface text-lg font-semibold text-foreground hover:border-brand disabled:cursor-wait disabled:opacity-60";

/**
 * A band contest's check-in stops in order, with up and down arrows always in the same two columns.
 * After a move, says where the stop went (for screen readers too) and keeps focus on that stop's arrow.
 */
export function CheckInOrderList({ stops }: { stops: StopRow[] }) {
  const [pending, start] = useTransition();
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The arrow to focus once the list redraws: the moved stop's same arrow, or its other one at the ends.
  const focusNext = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const want = focusNext.current;
    if (!want || pending) return;
    const pick = (dir: string) => list.current?.querySelector<HTMLButtonElement>(`button[data-stop="${want.id}"][data-dir="${dir}"]`);
    (pick(want.dir) ?? pick(want.dir === "up" ? "down" : "up"))?.focus();
    focusNext.current = null;
  }, [stops, pending]);

  const move = (s: StopRow, dir: "up" | "down", at: number) => {
    const action = dir === "up" ? s.up : s.down;
    if (!action) return;
    setError(null);
    focusNext.current = { id: s.id, dir };
    start(async () => {
      try {
        const r = await action();
        if (r?.error) setError(r.error);
        else setSaid(`${s.name} moved to stop ${dir === "up" ? at - 1 : at + 1} of ${stops.length}`);
      } catch {
        setError("That didn't save. Check your connection, then try again.");
      }
    });
  };

  return (
    <>
      <ol ref={list} className="mt-3 space-y-2">
        {stops.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span className="w-5 text-sm font-semibold text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <Link href={s.href} scroll={false} className="block truncate text-sm font-medium text-brand underline underline-offset-4">
                {s.name}
              </Link>
              <span className="block text-xs text-muted">{s.detail}</span>
              {s.needs && (
                <Link href={s.href} scroll={false} className="block text-xs font-medium text-warning">
                  <span aria-hidden>◆ </span>
                  {s.needs}
                </Link>
              )}
            </span>
            {/* Two fixed columns: up, then down. An arrow that can't be used keeps its space. */}
            {(["up", "down"] as const).map((dir) => {
              const can = dir === "up" ? i > 0 : i < stops.length - 1;
              return can ? (
                <button
                  key={dir}
                  type="button"
                  data-stop={s.id}
                  data-dir={dir}
                  disabled={pending}
                  aria-label={`Move ${s.name} ${dir === "up" ? "earlier" : "later"}`}
                  className={ARROW}
                  onClick={() => move(s, dir, i + 1)}
                >
                  <span aria-hidden>{dir === "up" ? "↑" : "↓"}</span>
                </button>
              ) : (
                <span key={dir} aria-hidden className="h-11 w-11 shrink-0" />
              );
            })}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm" aria-live="polite">
        {pending ? <span className="text-muted">Saving…</span> : said ? <span className="font-medium"><span aria-hidden className="text-success">✓ </span>{said}. Saved</span> : <span className="text-muted">Saves as you go</span>}
      </p>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </>
  );
}
