"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Upcoming = { name: string; date: string; showing: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Sponsors add-on, inside the account page's Add-ons panel (docs/design-decisions/2026-11-12-sponsors.md,
 * board 01 of the round-2 mock-ups): the switch, what it does, since when and by whom, and what's on the
 * account. Turning it off asks first, naming the upcoming events whose sponsors stop showing; its button is an
 * outline, because it hides sponsors and doesn't delete them.
 */
export function SponsorsAddOn({
  account,
  on,
  sinceLine,
  events,
  sponsors,
  upcoming,
  action,
}: {
  account: string;
  on: boolean;
  /** "Aug 4, 2025 (Jordan Lee)", when on. */
  sinceLine: string | null;
  /** Events with sponsors, and sponsors in all (kept, not removed). */
  events: number;
  sponsors: number;
  /** Upcoming published events with sponsors showing. */
  upcoming: Upcoming[];
  action: (on: boolean) => Promise<ActionState>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const flip = (next: boolean) =>
    start(async () => {
      setError(null);
      const result = await action(next);
      dialog.current?.close();
      if (result.error) setError(result.error);
      else if (result.message) toast(result.message);
    });

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="addon-sponsors" className="text-sm font-semibold">
            Sponsors
          </p>
          <p className="mt-0.5 text-sm text-muted">Organizers can thank their own sponsors on the public pages of band contests, festivals, and school fairs.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="addon-sponsors"
          disabled={pending}
          onClick={() => (on ? dialog.current?.showModal() : flip(true))}
          className="-my-2.5 inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 disabled:cursor-wait disabled:opacity-70"
        >
          <span aria-hidden className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 ${on ? "border-brand bg-brand" : "border-field-border bg-background"}`}>
            <span className={`absolute size-4 rounded-full ${on ? "left-[22px] bg-brand-foreground" : "left-[3px] bg-field-border"}`} />
          </span>
          <span className="text-sm font-semibold">{on ? "On" : "Off"}</span>
        </button>
      </div>
      <p className="mt-2 border-t border-border pt-2 text-xs text-muted">
        {on
          ? `On since ${sinceLine ?? "—"} · used on ${plural(events, "event")}, ${plural(sponsors, "sponsor")} in all`
          : `Off: organizers on this account don't see sponsor settings, and no sponsors show on their pages.${sponsors ? ` ${plural(sponsors, "sponsor")} kept.` : ""}`}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>Not saved. {error}
        </p>
      )}

      <dialog
        ref={dialog}
        aria-labelledby="addon-off-title"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="team-window m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border p-0 text-foreground shadow-elevated"
      >
        <div className="p-6">
          <h2 id="addon-off-title" className="text-xl font-semibold">
            Turn off Sponsors for {account}?
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
            {upcoming.length ? (
              <>
                <li>
                  Sponsors stop showing right away on {plural(upcoming.length, "upcoming event")}:{" "}
                  {upcoming.map((u, i) => (
                    <span key={`${u.name}-${i}`}>
                      {i > 0 && (i === upcoming.length - 1 ? "; and " : "; ")}
                      <span className="font-semibold">{u.name}</span> ({u.date}), {u.showing} showing
                    </span>
                  ))}
                </li>
                <li>{upcoming.length === 1 ? "Its" : "Their"} organizers see a line on the event page saying sponsors are off and kept</li>
              </>
            ) : (
              <li>No upcoming events are showing sponsors now</li>
            )}
            <li>
              {sponsors === 1 ? "The 1 sponsor is kept" : sponsors ? `All ${sponsors} sponsors are kept` : "Any sponsors added later are kept"}, so turning it back
              on shows them again
            </li>
            <li>Nobody is emailed</li>
          </ul>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()} autoFocus>
              Keep Sponsors on
            </Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => flip(false)}>
              {pending ? "Turning off…" : "Turn off Sponsors"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
