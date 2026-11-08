"use client";

import { useMemo, useState, useTransition } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { Badge, FormMessage, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

export type PastDirector = {
  email: string;
  name: string;
  bands: string[];
  /** Where they come from: "Last registered for Fall Classic", "From your spreadsheet". */
  note: string;
  registered: boolean;
  /** "Invited Oct 8", once emailed. */
  invited: string | null;
  /** "Goes out Aug 15": waiting for registration's opening day. */
  scheduled?: string | null;
  /** The last email to them couldn't be sent: "address" (refused), or "service" (on our side). */
  failed?: false | "address" | "service";
  /** Moved to a corrected address. */
  movedTo?: string | null;
};

const names = (list: PastDirector[]) => {
  const shown = list.slice(0, 6).map((d) => d.bands[0]?.replace(/ \(.*\)$/, "") || d.name || d.email);
  return list.length > 6 ? `${shown.join(", ")}, and ${list.length - 6} more` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")}${shown.length > 2 ? "," : ""} and ${shown.at(-1)}` : shown[0];
};

/**
 * Hosts: choose directors (from earlier contests, or imported) and email them an invitation to
 * register, or remind the ones already invited who haven't registered. Before registration's
 * opening day, invitations are scheduled for it instead. Every recipient is listed (no hidden
 * scrolling), and the question before sending names them. An invitation that couldn't be sent
 * can be moved to a corrected address right on its row.
 */
export function InvitePastBands({
  directors,
  canSend,
  cantSendReason,
  scheduleFor,
  send,
  fixAddress,
  cancelScheduled,
  one = "band",
  preview,
}: {
  directors: PastDirector[];
  canSend: boolean;
  /** Why invitations can't go out, when they can't. */
  cantSendReason?: string;
  /** Registration opens later: invitations wait for this day ("Sun, Aug 15"). */
  scheduleFor?: string | null;
  send: (emails: string[], reminder: boolean) => Promise<ActionState>;
  fixAddress: (from: string, to: string) => Promise<ActionState>;
  cancelScheduled: (email: string) => Promise<ActionState>;
  /** "band" or "group". */
  one?: string;
  /** What the invitation says, for "Preview the email". */
  preview: { subject: string; paragraphs: string[]; button: string; footer: string };
}) {
  const active = directors.filter((d) => !d.movedTo);
  // Chosen to start: everyone not yet registered, invited, or scheduled.
  const [picked, setPicked] = useState(() => new Set(active.filter((d) => !d.registered && !d.invited && !d.scheduled).map((d) => d.email)));
  const [query, setQuery] = useState("");
  const [fixing, setFixing] = useState<{ email: string; to: string } | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  const pickable = active.filter((d) => !d.registered);
  // Reminders: emailed, not registered, and the email went through.
  const remindable = active.filter((d) => d.invited && !d.registered && !d.failed);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? directors.filter((d) => [d.name, d.email, ...d.bands].some((t) => t.toLowerCase().includes(q))) : directors;
  }, [directors, query]);
  const toggle = (email: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(email);
      else next.delete(email);
      return next;
    });

  // Ask first, naming who gets it (nothing shows as sending while the question is open), then send.
  const go = async (list: PastDirector[], reminder: boolean) => {
    const n = list.length;
    const what = reminder ? (n === 1 ? "reminder" : "reminders") : n === 1 ? "invitation" : "invitations";
    const ok = await confirmDialog({
      title: scheduleFor ? `Schedule ${n} ${what} for ${scheduleFor}?` : `Send ${n} ${what}?`,
      message: `To ${names(list)}. ${
        reminder
          ? "Each gets one more email. Their earlier link still works."
          : scheduleFor
            ? `They go out early on ${scheduleFor}, when registration opens. Nobody is added to your team.`
            : "Each gets one email with the registration link and the deadline. Nobody is added to your team."
      }`,
      confirmLabel: scheduleFor ? "Schedule invitations" : reminder ? "Send reminders" : "Send invitations",
      cancelLabel: "Not yet",
    });
    if (!ok) return;
    start(async () => {
      const r = await send(
        list.map((d) => d.email),
        reminder,
      );
      setResult(r);
      if (r.ok && !reminder) setPicked(new Set());
    });
  };

  const chosen = pickable.filter((d) => picked.has(d.email));
  const btn = "inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold";
  const outline = `${btn} border-[1.5px] border-field-border bg-surface hover:border-brand disabled:cursor-not-allowed disabled:text-disabled`;
  return (
    <div className="space-y-4">
      {!canSend && cantSendReason && <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">{cantSendReason}</p>}
      {scheduleFor && (
        <p className="rounded-md border border-border bg-brand-soft px-3 py-2 text-sm">
          Registration opens {scheduleFor}. Choose directors now. Their invitations go out early that day.
        </p>
      )}
      <div>
        <label htmlFor="invite-search" className="sr-only">
          Search directors
        </label>
        <Input id="invite-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by school, band, or name" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <p>
          <span className="font-semibold">
            {picked.size} of {pickable.length} chosen
          </span>
          {remindable.length > 0 && <span className="text-muted"> · {remindable.length} invited, not registered yet</span>}
        </p>
        <span className="flex gap-3">
          <button type="button" className="min-h-11 font-semibold text-brand underline underline-offset-4" onClick={() => setPicked(new Set(pickable.map((d) => d.email)))}>
            Choose all
          </button>
          <button type="button" className="min-h-11 font-semibold text-brand underline underline-offset-4" onClick={() => setPicked(new Set())}>
            Choose none
          </button>
        </span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Directors">
        {shown.map((d) => (
          <li key={d.email} className="px-3 py-3">
            <label className={`flex items-start gap-3 ${d.registered || d.movedTo ? "" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--brand)]"
                checked={picked.has(d.email)}
                disabled={d.registered || Boolean(d.movedTo)}
                onChange={(e) => toggle(d.email, e.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{d.bands.join(", ") || d.email}</span>
                  {d.registered ? (
                    <Badge tone="success">Registered</Badge>
                  ) : d.movedTo ? (
                    <Badge tone="neutral">Moved to {d.movedTo}</Badge>
                  ) : d.failed ? (
                    <Badge tone="warning">Couldn&apos;t send</Badge>
                  ) : d.scheduled ? (
                    <>
                      <Badge tone="info">{d.scheduled}</Badge>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setResult(await cancelScheduled(d.email));
                          })
                        }
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
                      >
                        Don&apos;t send
                      </button>
                    </>
                  ) : (
                    d.invited && <Badge tone="info">{d.invited}</Badge>
                  )}
                </span>
                <span className="block break-all text-sm text-muted">{[d.name, d.email].filter(Boolean).join(" · ")}</span>
                <span className="block text-sm text-muted">{d.note}</span>
              </span>
            </label>
            {d.failed && !d.movedTo && !d.registered && (
              <div className="mt-2 pl-8">
                {fixing?.email === d.email ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      start(async () => {
                        const r = await fixAddress(d.email, fixing.to);
                        setResult(r);
                        if (r.ok) setFixing(null);
                      });
                    }}
                  >
                    <label className="min-w-0 basis-full text-sm font-semibold sm:flex-1 sm:basis-auto">
                      Corrected email
                      <Input type="email" required autoFocus value={fixing.to} onChange={(e) => setFixing({ email: d.email, to: e.target.value })} className="mt-1" />
                    </label>
                    <button type="submit" disabled={pending} className={outline}>
                      {scheduleFor ? "Save" : "Save and send"}
                    </button>
                    <button type="button" onClick={() => setFixing(null)} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold underline underline-offset-4">
                      Cancel
                    </button>
                  </form>
                ) : d.failed === "service" ? (
                  // Our side failed, not their address: try again first.
                  <p className="flex flex-wrap items-center gap-x-3 text-sm">
                    <span className="text-muted">We couldn&apos;t send this one. Try again in a moment.</span>
                    <button
                      type="button"
                      disabled={pending || !canSend}
                      onClick={() =>
                        start(async () => {
                          setResult(await send([d.email], false));
                        })
                      }
                      className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
                    >
                      Send again
                    </button>
                    <button type="button" onClick={() => setFixing({ email: d.email, to: d.email })} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                      Change address
                    </button>
                  </p>
                ) : (
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="text-muted">This address didn&apos;t accept our email. Check it for typos, or ask the school for the right one.</span>
                    <button type="button" onClick={() => setFixing({ email: d.email, to: d.email })} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                      Fix address
                    </button>
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="px-3 py-4 text-sm text-muted">No directors match “{query}”.</li>}
      </ul>
      <FormMessage error={result.error} success={result.message} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSend || chosen.length === 0 || pending}
          onClick={() => void go(chosen, false)}
          className={`${btn} bg-brand text-brand-foreground hover:bg-brand-hover disabled:cursor-not-allowed disabled:border-[1.5px] disabled:border-field-border disabled:bg-transparent disabled:text-disabled`}
        >
          {pending
            ? "Saving…"
            : scheduleFor
              ? `Schedule ${chosen.length} ${chosen.length === 1 ? "invitation" : "invitations"} for ${scheduleFor}`
              : `Send ${chosen.length} ${chosen.length === 1 ? "invitation" : "invitations"}`}
        </button>
        {remindable.length > 0 && !scheduleFor && (
          <button type="button" disabled={!canSend || pending} onClick={() => void go(remindable, true)} className={outline}>
            Remind {remindable.length} who haven&apos;t registered
          </button>
        )}
      </div>
      {!canSend && cantSendReason && <p className="text-sm text-muted">{cantSendReason}</p>}
      <details className="group text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-brand">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          Preview the email
        </summary>
        <div className="mt-2 rounded-lg border border-border bg-background p-4 leading-6">
          <p className="font-semibold">{preview.subject}</p>
          {preview.paragraphs.map((p) => (
            <p key={p} className="mt-2">
              {p}
            </p>
          ))}
          <p className="mt-3">
            <span className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 font-semibold text-brand-foreground">{preview.button}</span>
          </p>
          <p className="mt-3 text-sm text-muted">{preview.footer}</p>
        </div>
      </details>
      <p className="text-sm text-muted">
        Each email&apos;s button works once, for 7 days after it arrives, and fills in their {one}&apos;s details. After that,
        directors confirm their email with a code. Sending again doesn&apos;t cancel the first email.
      </p>
    </div>
  );
}
