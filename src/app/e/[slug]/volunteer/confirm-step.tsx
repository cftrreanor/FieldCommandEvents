"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useActionState, useState, type ReactNode } from "react";
import { ActionPendingContext } from "@/components/action-form";
import { BotCheck } from "@/components/bot-check";
import { confirmDialog } from "@/components/confirm-dialog";
import { CONFIRM_ADULT_LABEL, CONFIRM_UNDER_18_LINK } from "@/lib/confirm-age";
import { SubmitButton } from "@/components/submit-button";
import { Card, Field, FormMessage, Input } from "@/components/ui";
import type { ConfirmState } from "./actions";
import { SignedUpContext } from "./more-ways-block";
import { Confirmed, confirmFinePrint } from "./signup-form";

export type ConfirmShift = { id: string; job: string; when: string; clock: string; spotsLeft: number; startsAt: string };

const LINK = "inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4";
const spots = (n: number) => (n === 1 ? "1 spot open" : `${n} spots open`);

/** The open shift nearest in time to one that filled up (the same time, at another job, comes first). */
function nearest(to: ConfirmShift, shifts: ConfirmShift[]) {
  const t = new Date(to.startsAt).getTime();
  return (
    shifts
      .filter((s) => s.id !== to.id && s.spotsLeft > 0)
      .sort((a, b) => Math.abs(new Date(a.startsAt).getTime() - t) - Math.abs(new Date(b.startsAt).getTime() - t))[0] ?? null
  );
}

/**
 * Another event's shift, tapped from "More ways to help" or the organization page: one light card to confirm it.
 * With details this device remembers for this account, they're shown (the email masked, the phone only as its last
 * four digits) and nothing is typed; otherwise only the missing fields (name, email, phone) and a required "I'm 18 or
 * older", with the full form for anyone under 18. If the shift filled up, nothing was saved and the nearest open
 * shift is offered instead, still highlighted.
 */
export function ConfirmStep({
  action,
  forget,
  shift,
  shifts,
  remembered,
  needs,
  via,
  keepsHistory,
  eventName,
  pickHref,
  underHref,
  differentHref,
  backHref,
  startsFull,
  more,
}: {
  action: (prev: ConfirmState, formData: FormData) => Promise<ConfirmState>;
  forget: (formData: FormData) => Promise<void>;
  shift: ConfirmShift;
  /** This event's other shifts, for the nearest open one if this one fills up. */
  shifts: ConfirmShift[];
  /** `email` arrives masked ("p•••@example.com"): the full address stays on the server. */
  remembered: { name: string; email: string; phoneEnding: string | null; from: string | null } | null;
  /** The fields this device doesn't have. */
  needs: { name: boolean; email: boolean; phone: boolean };
  via: string;
  keepsHistory: boolean;
  eventName: string;
  /** The full form, for a different shift. */
  pickHref: string;
  /** The full form with this shift ticked and "I'm under 18" ticked. */
  underHref: string;
  /** This step without the remembered details. */
  differentHref: string;
  /** This step's own address (to come back to after forgetting the device). */
  backHref: string;
  /** The shift was already full when the page opened. */
  startsFull: boolean;
  more?: ReactNode;
}) {
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState(action, {});
  // Shifts found full (when the page opened, or when confirming): the next pick is the open one nearest in time.
  const [full, setFull] = useState<string[]>(startsFull ? [shift.id] : []);
  const [tried, setTried] = useState<string | null>(null);
  const [seen, setSeen] = useState<ConfirmState>(state);
  if (state !== seen) {
    setSeen(state);
    if (state.filled && tried && !full.includes(tried)) setFull([...full, tried]);
  }
  const lastFull = full.length ? (shifts.find((s) => s.id === full.at(-1)) ?? shift) : null;
  const filled = lastFull ? { job: lastFull.job, at: lastFull.clock } : null;
  const choice = lastFull ? nearest(shift, shifts.filter((s) => !full.includes(s.id))) : shift;
  const first = remembered?.name.trim().split(/\s+/)[0] ?? "";

  if (state.confirmed) {
    return (
      <>
        <Confirmed confirmed={state.confirmed} pathname={pathname} />
        <SignedUpContext value={{ confirmed: true, booked: state.confirmed.booked, carries: state.confirmed.carriesOver }}>{more}</SignedUpContext>
      </>
    );
  }

  return (
    <>
      <Card className="space-y-4 p-4 sm:space-y-5 sm:p-6">
        <h2 className="text-xl font-semibold">Sign up for this shift?</h2>
        {filled && (
          <div role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-3 text-sm leading-6">
            <p className="font-semibold text-danger">
              {filled.job} at {filled.at} just filled up.
            </p>
            <p className="mt-1">Nothing was saved.{choice ? "" : " Every other shift here is full too."}</p>
          </div>
        )}
        {choice && (
          // The shift they'll get keeps its highlight, the first pick or the one offered in its place.
          <div className="rounded-lg border border-brand bg-brand-soft px-4 py-2.5">
            <p className="font-semibold [overflow-wrap:anywhere]">{choice.job}</p>
            <p className="text-sm">{choice.when}</p>
            <p className="text-sm font-medium">{spots(choice.spotsLeft)}</p>
          </div>
        )}
        {choice && (
          <form
            action={(data) => {
              setTried(choice.id);
              return formAction(data);
            }}
            className="space-y-4 sm:space-y-5"
          >
            <ActionPendingContext value={pending}>
              <input type="hidden" name="shift" value={choice.id} />
              <input type="hidden" name="via" value={via} />
              <input type="hidden" name="back" value={backHref} />
              {!remembered && <input type="hidden" name="fresh" value="1" />}
              {/* Bot trap: hidden from people, tempting to scripts. */}
              <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                <label>
                  Website <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              {remembered && (
                <div>
                  <p className="text-sm font-semibold">Signing up as</p>
                  <p className="mt-1 leading-7 [overflow-wrap:anywhere]">
                    {remembered.name} · {remembered.email}
                    {remembered.phoneEnding ? ` · Phone ending ${remembered.phoneEnding}` : ""}
                  </p>
                  <p className="text-sm text-muted">{remembered.from ? `From your ${remembered.from} sign-up on this device` : "From your sign-up on this device"}</p>
                  <p>
                    <Link href={differentHref} className={LINK}>
                      Not {first}? Use different details
                    </Link>
                  </p>
                </div>
              )}
              {(needs.name || needs.email || needs.phone) && (
                <div className="space-y-4">
                  {needs.name && (
                    <Field label="Full name">
                      <Input name="name" autoComplete="name" required maxLength={200} />
                    </Field>
                  )}
                  {needs.email && (
                    <Field label="Email" hint="We'll send the confirmation here.">
                      <Input name="email" type="email" inputMode="email" autoComplete="email" required />
                    </Field>
                  )}
                  {needs.phone && (
                    <Field label="Cell phone" hint="Only the people running this event see it, and only on event day.">
                      <Input name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
                    </Field>
                  )}
                </div>
              )}
              {!remembered && (
                // One adult only: anyone under 18 uses the full form (ages, Adults only, a guardian's consent).
                <div>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium">
                    <input type="checkbox" name="adult" value="1" required className="h-5 w-5 shrink-0 accent-[var(--brand)]" />
                    <span>{CONFIRM_ADULT_LABEL}</span>
                  </label>
                  <p>
                    <Link href={underHref} className={LINK}>
                      {CONFIRM_UNDER_18_LINK}
                    </Link>
                  </p>
                </div>
              )}
              <BotCheck eager />
              <FormMessage error={state.error} />
              <div className="space-y-1">
                <SubmitButton className="w-full text-base" pendingText="Signing you up…">
                  {filled ? `Sign up for ${choice.job}` : "Confirm sign-up"}
                  <span className="sr-only">
                    {" "}
                    for {choice.job}, {choice.when}
                  </span>
                </SubmitButton>
                <p className="flex flex-wrap justify-center gap-x-5">
                  <Link href={pickHref} className={LINK}>
                    Pick a different shift
                  </Link>
                </p>
              </div>
              <p className="text-center text-xs leading-5 text-muted">{confirmFinePrint(eventName, keepsHistory, needs.phone)}</p>
              {remembered && (
                // Under the privacy note, away from the main way out, and it asks first (built-page review).
                <p className="text-center">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-sm font-medium text-muted underline underline-offset-4 hover:text-foreground"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: "Forget this device?",
                        message: "Your sign-ups stay booked, but this phone won't show them in My volunteering.",
                        confirmLabel: "Forget this device",
                        cancelLabel: "Keep it",
                      });
                      if (!ok) return;
                      const data = new FormData();
                      data.set("back", backHref);
                      startTransition(() => forget(data));
                    }}
                  >
                    Forget this device
                  </button>
                </p>
              )}
            </ActionPendingContext>
          </form>
        )}
        {!choice && (
          <p>
            <Link href={pickHref} className={LINK}>
              See this event&apos;s shifts
            </Link>
          </p>
        )}
      </Card>
      {(filled && !choice) || startsFull ? more : null}
    </>
  );
}
