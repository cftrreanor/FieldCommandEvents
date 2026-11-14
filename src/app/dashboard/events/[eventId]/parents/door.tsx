"use client";

import { startTransition, useMemo, useOptimistic, useState } from "react";
import { Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { confirmDialog } from "@/components/confirm-dialog";

/** One adult on a registration (their own record). position 0 is the parent who registered. */
export type DoorAdult = { id: string; position: number; name: string; firstName: string; checkedIn: boolean; sentToOffice: boolean };

export type DoorParent = {
  id: string;
  phone: string | null;
  phoneDisplay: string | null;
  children: { name: string; teacher: string; grade: string }[];
  adults: DoorAdult[];
};

/** The door: find a family, look at each adult's photo ID, check each one in as they arrive. */
export function Door({
  parents,
  open,
  opensOn,
  toggle,
}: {
  parents: DoorParent[];
  /** Check-in is on (the day before through the event). Otherwise the list is read-only. */
  open: boolean;
  /** When the check-in buttons turn on, for the note shown before then. */
  opensOn: string;
  toggle: (adultId: string, checkedIn: boolean) => Promise<ActionState>;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useOptimistic(
    parents,
    (state, change: { adultId: string; checkedIn: boolean }) =>
      state.map((p) => ({ ...p, adults: p.adults.map((a) => (a.id === change.adultId ? { ...a, checkedIn: change.checkedIn } : a)) })),
  );
  const everyone = optimistic.flatMap((p) => p.adults);
  const here = everyone.filter((a) => a.checkedIn).length;

  async function onToggle(a: DoorAdult) {
    if (a.checkedIn && !(await confirmDialog({ title: `Undo ${a.name}'s check-in?`, confirmLabel: "Undo check-in" }))) return;
    setError(null);
    startTransition(async () => {
      setOptimistic({ adultId: a.id, checkedIn: !a.checkedIn });
      try {
        const result = await toggle(a.id, !a.checkedIn);
        if (result.error) setError(result.error);
      } catch {
        setError("That didn't go through. Check your signal and tap again.");
      }
    });
  }

  // Any adult's name, the children's names and teachers, and the phone (the door never gets email addresses).
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? optimistic.filter((p) =>
            [...p.adults.map((a) => a.name), p.phone ?? "", p.phoneDisplay ?? "", ...p.children.flatMap((c) => [c.name, c.teacher])].some(
              (x) => x.toLowerCase().includes(q),
            ),
          )
        : optimistic,
    [optimistic, q],
  );

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            <span className="text-2xl font-semibold tabular-nums">{here}</span>
            <span className="text-muted"> / {everyone.length} adults checked in</span>
          </p>
          <Input
            type="search"
            placeholder="Adult, child, or teacher"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-xs"
            aria-label="Find a parent"
          />
        </div>
        {error && (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      {!open && optimistic.length > 0 && (
        <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">Check-in buttons turn on {opensOn}, so no one gets checked in early.</p>
      )}
      {optimistic.length === 0 ? (
        <p className="mt-6 text-muted">No one has registered yet.</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 text-muted">
          No one matches that. Not registered? They need to go through the school&apos;s visitor process instead.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {shown.map((p) => (
            <li key={p.id} className="rounded-xl border border-border bg-surface shadow-card">
              <div className="px-3 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{p.children.length > 1 ? "Children" : "Child"}</p>
                <ul className="text-sm">
                  {p.children.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.grade} · {c.teacher}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <ul className="mt-2 divide-y divide-border border-t border-border">
                {p.adults.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">{a.name}</p>
                      {a.position === 0 && p.phone && (
                        <a href={`tel:${p.phone}`} aria-label={`Call ${a.name}, ${p.phoneDisplay}`} className="inline-flex min-h-11 items-center text-sm font-medium text-brand hover:underline">
                          {p.phoneDisplay}
                        </a>
                      )}
                    </div>
                    {a.sentToOffice ? (
                      // A Host stopped this adult at the door: a plain note takes the button's place, so it can't be tapped through.
                      <p className="flex min-h-12 w-36 shrink-0 items-center rounded-md border-2 border-foreground bg-surface px-3 py-1.5 text-sm font-semibold leading-snug sm:w-48">
                        Please ask {a.firstName} to go to the front office.
                      </p>
                    ) : !open ? (
                      a.checkedIn && <span className="shrink-0 text-sm font-semibold text-success">✓ Checked in</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onToggle(a)}
                        aria-pressed={a.checkedIn}
                        aria-label={a.checkedIn ? `${a.name} is checked in. Tap to undo.` : `ID checked: check in ${a.name}`}
                        className={`flex min-h-12 min-w-36 shrink-0 flex-col items-center justify-center rounded-md px-3 text-sm font-semibold transition ${
                          a.checkedIn ? "border border-success bg-surface text-foreground" : "bg-brand text-brand-foreground hover:bg-brand-hover"
                        }`}
                      >
                        {a.checkedIn ? (
                          <>
                            <span>✓ Checked in</span>
                            <span className="text-[11px] font-normal text-muted">tap to undo</span>
                          </>
                        ) : (
                          <>
                            <span>Check in</span>
                            <span className="text-[11px] font-normal opacity-80">photo ID checked</span>
                          </>
                        )}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
