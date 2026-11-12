"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { addClassifications, removeClassification, type FieldSaveState } from "@/app/dashboard/band-registration-actions";
import { ChipAdder } from "@/components/chip-adder";
import { DateField } from "@/components/date-field";
import { LineIcon } from "@/components/line-icon";
import { NumberInput } from "@/components/number-input";
import { setPending, useLeaveGuard } from "@/components/pending-edits";
import { Input, Textarea } from "@/components/ui";
import { AutoField, marked, useAutosave, withClass } from "./registration-settings";

const CONNECTION = "Check your connection, then select Retry.";

/** One-tap sets of classifications (owner, 2026-11-11): optional, and the list starts empty. */
const SETS = [
  { label: "1A to 6A", names: ["1A", "2A", "3A", "4A", "5A", "6A"] },
  { label: "Varsity and Non-varsity", names: ["Varsity", "Non-varsity"] },
  { label: "Middle school and High school", names: ["Middle school", "High school"] },
];

type Failure = { message: string; retry: boolean } | null;

/**
 * A festival's Registration step (and its Registration settings once it's live): the deadline (all that
 * publishing needs), a group limit, optional classifications, what to ask each group, and information and a
 * payment link for directors. Each box saves itself, one at a time, with the same pinned bar as the other steps.
 */
export function FestivalRegistration({
  eventId,
  initial,
  groupsIn: initialGroupsIn,
  next,
  draft,
  today,
  festival,
}: {
  eventId: string;
  initial: {
    deadline: string;
    maxGroups: number | null;
    classifications: string[];
    askChaperones: boolean;
    askBuses: boolean;
    askAvailability: boolean;
    directorInfo: string;
    paymentLink: string;
  };
  /** Groups registered in each classification (those can't be removed). */
  groupsIn: Record<string, number>;
  /** The way on, in the pinned bar (the Registration step goes on to Volunteers). */
  next?: { href: string; label: string };
  draft: boolean;
  /** Today in the festival's time zone (YYYY-MM-DD). */
  today: string;
  /** The festival's first day, as a date and in words, the last day the deadline can be, and whether it lasts more than one day. */
  festival: { label: string; lastDeadline: string; multiDay: boolean };
}) {
  const counts = useLeaveGuard("A change to registration");
  const root = useRef<HTMLDivElement>(null);
  const deadline = useAutosave(eventId, "deadline", initial.deadline, {
    immediate: true,
    restore: true,
    check: (v) =>
      v && v !== initial.deadline && v < today
        ? `Pick today or a later date, before the festival (${festival.label}).`
        : v && v > festival.lastDeadline
          ? `Pick a date before the festival (${festival.label}).`
          : null,
  });
  const limit = useAutosave(eventId, "maxGroups", initial.maxGroups ? String(initial.maxGroups) : "", {
    check: (v) => (v.trim() && (Number(v) < 1 || Number(v) > 2000) ? "Use a number from 1 to 2,000, or leave it empty for no limit." : null),
  });
  const chaperones = useAutosave(eventId, "askChaperones", String(initial.askChaperones), { immediate: true });
  const buses = useAutosave(eventId, "askBuses", String(initial.askBuses), { immediate: true });
  const availability = useAutosave(eventId, "askAvailability", String(initial.askAvailability), { immediate: true });
  const info = useAutosave(eventId, "directorInfo", initial.directorInfo);
  const pay = useAutosave(eventId, "paymentLink", initial.paymentLink, {
    check: (v) => (v.trim() && !/^https:\/\/\S+$/.test(v.trim()) ? "Use a full https:// link, like https://yourschool.org/pay." : null),
  });
  const fields = [deadline, limit, chaperones, buses, availability, info, pay];

  // Classifications: added and removed one at a time, so a co-host's changes are kept.
  const [list, setList] = useState(initial.classifications);
  const [groupsIn] = useState(initialGroupsIn);
  const [typing, setTyping] = useState(false);
  const [cls, setCls] = useState<{ busy: boolean; failure: Failure; saved: boolean }>({ busy: false, failure: null, saved: false });
  const lastOp = useRef<(() => void) | null>(null);
  const clsKey = useId();
  useEffect(() => {
    setPending(clsKey, cls.busy ? { kind: "saving" } : cls.failure?.retry ? { kind: "failed", flush: () => lastOp.current?.() } : null);
    return () => setPending(clsKey, null);
  }, [cls, clsKey]);
  async function run(op: () => Promise<FieldSaveState & { classifications?: string[] }>) {
    lastOp.current = () => void run(op);
    setCls({ busy: true, failure: null, saved: false });
    let r: FieldSaveState & { classifications?: string[] };
    try {
      r = await op();
    } catch {
      return setCls({ busy: false, failure: { message: CONNECTION, retry: true }, saved: false });
    }
    if (r.classifications) setList(r.classifications);
    setCls({ busy: false, failure: r.error ? { message: r.error, retry: Boolean(r.retry) } : null, saved: !r.error });
  }
  const add = (names: string[]) => {
    const fresh = names.filter((n) => !list.some((x) => x.toLowerCase() === n.toLowerCase()));
    if (fresh.length && !cls.busy) void run(() => addClassifications(eventId, fresh));
  };

  const showFailed = () => {
    const el = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };
  const saving = counts.saving > 0 || cls.busy;
  const failed = counts.failed > 0;
  const anySaved = cls.saved || fields.some((f) => f.state === "saved");
  const outline =
    "inline-flex min-h-11 items-center rounded-md border-[1.5px] border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand disabled:cursor-not-allowed disabled:text-disabled";
  const sets = SETS.filter((set) => set.names.some((n) => !list.some((x) => x.toLowerCase() === n.toLowerCase())));

  /** A yes-or-no question for each group, saved as soon as it's switched. */
  const ask = (id: string, saver: typeof chaperones, label: string, hint: string) => (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={saver.value === "true"}
        onChange={(e) => saver.change(e.target.checked ? "true" : "false")}
        aria-invalid={Boolean(saver.failure) || undefined}
        className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-muted">{hint}</span>
        {saver.failure && (
          <span role="alert" className="block font-semibold text-danger">
            <span aria-hidden>▲ </span>Not saved. {saver.failure.message}
          </span>
        )}
      </span>
    </label>
  );

  return (
    <div ref={root} className="rounded-lg border border-border bg-surface shadow-card">
      <div className="space-y-7 p-4 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <AutoField
            id="reg-deadline"
            label="Registration deadline"
            required
            hint={`Directors can register, change, or withdraw their group through the end of this day, your time. It must be before the festival (${festival.label}).`}
            saver={deadline}
          >
            <DateField
              value={deadline.value}
              min={initial.deadline && initial.deadline < today ? initial.deadline : today}
              max={festival.lastDeadline}
              onChange={(e) => deadline.change(e.target.value)}
              {...marked("reg-deadline", deadline)}
              className="max-w-xs"
            />
          </AutoField>
          <AutoField
            id="reg-limit"
            label="Group limit (optional)"
            hint="Registration closes on its own when this many groups have registered. Leave it empty for no limit."
            saver={limit}
          >
            <NumberInput value={limit.value} onChange={(e) => limit.change(e.target.value)} {...withClass(marked("reg-limit", limit), "max-w-[8rem]")} />
          </AutoField>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Classifications (optional)</legend>
          <p id="cls-hint" className="mt-1 text-sm text-muted">
            What directors pick from, like 1A to 6A or Varsity, if your festival uses them. You can sort the schedule by them later.
          </p>
          {list.length > 0 && (
            <ul className="mt-3 flex flex-wrap items-start gap-2" aria-label="Classifications">
              {list.map((c) => {
                const n = groupsIn[c] ?? 0;
                return (
                  <li key={c} className="inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-field-border bg-background text-sm font-semibold">
                    <span className="pl-3">{c}</span>
                    {n > 0 ? (
                      <span className="pr-3 pl-1 font-normal text-muted">· {n === 1 ? "1 group" : `${n} groups`}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={cls.busy}
                        onClick={() => void run(() => removeClassification(eventId, c))}
                        aria-label={`Remove ${c}`}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-lg text-muted hover:text-danger disabled:text-disabled"
                      >
                        ×
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {list.length > 0 && Object.values(groupsIn).some((n) => n > 0) && (
            <p className="mt-2 text-sm text-muted">A classification with groups in it can&apos;t be removed.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {sets.map((set) => (
              <button key={set.label} type="button" disabled={cls.busy} onClick={() => add(set.names)} className={outline}>
                Add {set.label}
              </button>
            ))}
            {!typing && (
              // A button like the others beside it (12 px corners, solid outline: light check on the built update).
              <button type="button" onClick={() => setTyping(true)} className={outline}>
                Type your own
              </button>
            )}
          </div>
          {typing && (
            <div className="mt-3">
              <ChipAdder
                suggestions={[]}
                existing={list}
                onAdd={add}
                busy={cls.busy}
                placeholder={list.length ? "Add another" : "For example, Concert or Chamber"}
                label="Add a classification"
                describedBy={[cls.failure && "cls-error", "cls-hint"].filter(Boolean).join(" ")}
                invalid={Boolean(cls.failure)}
              />
            </div>
          )}
          {cls.failure && (
            <p id="cls-error" role="alert" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-danger">
              <span>
                <span aria-hidden>▲ </span>Not saved. {cls.failure.message}
              </span>
              {cls.failure.retry && (
                <button type="button" onClick={() => lastOp.current?.()} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
                  Retry
                </button>
              )}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold">Ask each group</legend>
          <p className="mt-1 text-sm text-muted">Directors always give their group&apos;s name, school, and how many performers. Switch on anything else you need.</p>
          <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {/* Always asked: a locked choice is solid and muted, with a lock (L27). */}
            <p className="flex min-h-11 items-start gap-3 py-1.5 text-sm">
              <input type="checkbox" checked disabled aria-label="How many performers (always asked)" className="mt-0.5 size-5 shrink-0" />
              <span>
                <span className="font-medium">How many performers</span>
                <span className="block text-muted">
                  <LineIcon name="lock" inline />
                  Always asked
                </span>
              </span>
            </p>
            {ask("ask-chaperones", chaperones, "How many chaperones", "For seating and meals")}
            {ask("ask-buses", buses, "How many buses", "For bus parking")}
            {ask(
              "ask-availability",
              availability,
              festival.multiDay ? "Which days they can come, and earliest and latest times" : "Earliest and latest times they can perform",
              "The schedule warns you when a group's times break these.",
            )}
          </div>
        </fieldset>

        <AutoField
          id="reg-info"
          label="Information for directors (optional)"
          hint="Shown on the registration form, in directors' emails, and on each group's page. For example, the entry fee and how to pay, where to unload, and bus parking."
          saver={info}
        >
          <Textarea value={info.value} onChange={(e) => info.change(e.target.value)} rows={5} maxLength={3000} {...withClass(marked("reg-info", info), "w-full")} />
        </AutoField>

        <AutoField id="reg-pay" label="Payment link (optional)" hint="If directors pay online, paste the full link. It shows as a “Pay the entry fee” button." saver={pay}>
          <Input type="url" inputMode="url" value={pay.value} onChange={(e) => pay.change(e.target.value)} {...withClass(marked("reg-pay", pay), "w-full")} />
        </AutoField>
      </div>

      {/* Pinned to the bottom of the screen: whether everything is saved, and the way on (the same bar as the other steps). */}
      <div className="sticky bottom-[var(--day-bar,0px)] z-10 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
        <div className="min-w-0 flex-1 text-sm" role="status">
          {failed ? (
            <p className="flex flex-wrap items-center gap-x-2 font-semibold text-danger">
              <span>
                <span aria-hidden>▲ </span>Something isn&apos;t saved
              </span>
              <button type="button" onClick={showFailed} className="inline-flex min-h-11 items-center underline underline-offset-4">
                Show me
              </button>
            </p>
          ) : saving ? (
            <p className="text-muted">Saving…</p>
          ) : counts.incomplete ? (
            <p className="text-muted">Not saved yet. Finish the box you&apos;re typing in.</p>
          ) : counts.unadded ? (
            <p className="font-medium text-warning">
              <span aria-hidden>◆ </span>Typed but not added. Select Add to keep it.
            </p>
          ) : anySaved ? (
            <p className="font-medium">
              <span aria-hidden className="text-success">
                ✓{" "}
              </span>
              Saved
            </p>
          ) : (
            <p className="text-muted">Saves as you go</p>
          )}
        </div>
        {next && (
          <Link href={next.href} className="ml-auto inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
            Next up:&nbsp;{next.label} →
          </Link>
        )}
        {draft && !deadline.value && (
          <p className="hidden basis-full text-sm text-muted sm:block">You can leave and come back. Before you publish, add the registration deadline.</p>
        )}
      </div>
    </div>
  );
}
