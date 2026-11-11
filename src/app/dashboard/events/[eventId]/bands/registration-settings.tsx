"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  addClassifications,
  removeClassification,
  renameClassification,
  saveRegistrationField,
  type FieldSaveState,
  type RegistrationField,
} from "@/app/dashboard/band-registration-actions";
import { NumberInput } from "@/components/number-input";
import { setPending, useLeaveGuard } from "@/components/pending-edits";
import { Input, Textarea } from "@/components/ui";
import { ChipAdder } from "@/components/chip-adder";
import { normalizePhone } from "@/lib/phone";
import { formatDate } from "@/lib/time";
import { DateField } from "@/components/date-field";

/** How long after the last keystroke a field saves itself. */
const SAVE_AFTER_MS = 900;
const PRESETS = {
  uil: ["1A", "2A", "3A", "4A", "5A", "6A"],
  divisions: ["Division I", "Division II", "Division III"],
};
const CONNECTION = "Check your connection, then select Retry.";

type FieldState = "idle" | "waiting" | "saving" | "saved" | "failed";
type Failure = { message: string; retry: boolean } | null;

/**
 * One field that saves itself a moment after the last change (or at once, like a date). It tells
 * the page-wide record of unsaved edits, so the bar says what's happening and leaving waits for it.
 * - `check` catches a value that can't be saved yet (a half-typed phone number): it waits, and says
 *   why only when the person leaves the box, not while they're typing.
 * - A value the server refuses says why next to the box. Retry is offered only when trying again
 *   could work (a dropped connection). `restore` puts the last saved value back instead (a date).
 */
export function useAutosave(
  eventId: string,
  field: RegistrationField,
  initial: string,
  opts: { immediate?: boolean; check?: (v: string) => string | null; restore?: boolean } = {},
) {
  const key = useId();
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<FieldState>("idle");
  const [failure, setFailure] = useState<Failure>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);
  const saved = useRef(initial);
  const { immediate = false, check, restore = false } = opts;
  // The save, for a retry offered from inside itself.
  const again = useRef<() => void>(() => {});

  const fail = useCallback(
    (message: string, retry: boolean) => {
      setFailure({ message, retry });
      if (restore && !retry) {
        // Put back what's saved: nothing is left unsaved, the reason stays beside the box.
        setValue(saved.current);
        latest.current = saved.current;
        setState("idle");
        setPending(key, null);
        return;
      }
      setState("failed");
      setPending(key, { kind: "failed", flush: retry ? () => again.current() : undefined });
    },
    [key, restore],
  );

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    const problem = check?.(v);
    if (problem) return fail(problem, false);
    setState("saving");
    setPending(key, { kind: "saving" });
    let r: FieldSaveState;
    try {
      r = await saveRegistrationField(eventId, field, v);
    } catch {
      return fail(CONNECTION, true);
    }
    if (r.error) return fail(r.error, Boolean(r.retry));
    saved.current = v;
    setFailure(null);
    // A newer change waiting to save keeps the field "waiting".
    if (latest.current === v) {
      setState("saved");
      setPending(key, null);
    }
  }, [eventId, field, key, check, fail]);
  useEffect(() => {
    again.current = () => void save();
  }, [save]);

  const change = (v: string) => {
    setValue(v);
    latest.current = v;
    setFailure(null);
    if (timer.current) clearTimeout(timer.current);
    if (v === saved.current) {
      setState("idle");
      setPending(key, null);
      return;
    }
    setState("waiting");
    if (check?.(v)) {
      // A date is picked whole: say why at once. A half-typed value waits, and says why when they leave the box.
      if (immediate) return void save();
      setPending(key, { kind: "incomplete", flush: () => void save() });
      return;
    }
    setPending(key, { kind: "saving", flush: () => void save() });
    if (immediate) void save();
    else timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  /** Leaving the box saves now, so a value that can't be saved says why straight away. */
  const blur = () => {
    if (state === "waiting") void save();
  };

  useEffect(() => () => setPending(key, null), [key]);
  return { value, change, blur, state, failure, retry: save };
}

export type Saver = ReturnType<typeof useAutosave>;

/** A field's label, hint, box, and, if its save failed, the reason (with Retry when it could help) right beside it. */
export function AutoField({
  label,
  hint,
  required = false,
  saver,
  children,
  id,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  saver: Saver;
  children: React.ReactNode;
  id: string;
}) {
  const f = saver.failure;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
        {required && <span aria-hidden> *</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="mt-1.5">{children}</div>
      {f && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-danger">
          <span>
            <span aria-hidden>▲ </span>Not saved. {f.message}
          </span>
          {f.retry && (
            <button type="button" onClick={() => void saver.retry()} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
              Retry
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/** Props that mark a box whose save failed, in red even while it has focus. */
export function marked(id: string, s: Saver, hint = true) {
  const bad = Boolean(s.failure);
  return {
    id,
    "aria-invalid": bad || undefined,
    "aria-describedby": [hint && `${id}-hint`, bad && `${id}-error`].filter(Boolean).join(" ") || undefined,
    onBlur: s.blur,
    className: bad ? "border-2 border-danger! ring-[3px]! ring-danger/25!" : "",
  };
}

/**
 * Band registration settings (a band contest's step 2, and its Registration settings once it's
 * live): classifications, the deadline, information and a payment link for directors, and who they
 * can call. Each field saves itself; the pinned bar says whether everything is saved, and the way on.
 */
export function RegistrationSettings({
  eventId,
  initial,
  bandsIn: initialBandsIn,
  contactSaved,
  next,
  draft,
  today,
  contest,
  alreadyOpen = false,
}: {
  eventId: string;
  initial: {
    classifications: string[];
    deadline: string;
    /** The day registration opens; empty opens it when the event is published. */
    opensOn: string;
    directorInfo: string;
    paymentLink: string;
    chaperoneLimit: number;
    contact: { name: string; phone: string; email: string };
    /** Meals for visiting bands; null before the 20270111000000 update. */
    meals: { offered: boolean; priceCents: number | null; details: string; options: string[] } | null;
  };
  /** How many bands are registered in each classification (they can't be removed while it's above 0). */
  bandsIn: Record<string, number>;
  contactSaved: boolean;
  /** The way on, in the pinned bar (step 2 of setup goes on to Publish). */
  next?: { href: string; label: string };
  /** Not published yet: say what publishing needs. */
  draft: boolean;
  /** Today in the event's time zone (YYYY-MM-DD). */
  today: string;
  /** Published with registration already open: the opening day can't move later. */
  alreadyOpen?: boolean;
  /** Contest day: the deadline falls before it. */
  contest: { day: string; label: string; lastDeadline: string };
}) {
  const counts = useLeaveGuard("A change to registration");
  const root = useRef<HTMLDivElement>(null);
  const deadline = useAutosave(eventId, "deadline", initial.deadline, {
    immediate: true,
    restore: true,
    check: (v) =>
      v && v !== initial.deadline && v < today
        ? `Pick today or a later date, before contest day (${contest.label}).`
        : v && v > contest.lastDeadline
          ? `Pick a date before contest day (${contest.label}).`
          : null,
  });
  const opensOn = useAutosave(eventId, "opensOn", initial.opensOn, {
    immediate: true,
    restore: true,
    check: (v) =>
      v && v !== initial.opensOn && v < today
        ? "Pick today or a later date."
        : v && deadline.value && v > deadline.value
          ? `Pick a day on or before the deadline (${formatDate(deadline.value, { weekday: undefined, year: undefined })}).`
          : null,
  });
  const info = useAutosave(eventId, "directorInfo", initial.directorInfo);
  const pay = useAutosave(eventId, "paymentLink", initial.paymentLink, {
    check: (v) => (v.trim() && !/^https:\/\/\S+$/.test(v.trim()) ? "Use a full https:// link, like https://yourschool.org/pay." : null),
  });
  const chaperones = useAutosave(eventId, "chaperoneLimit", String(initial.chaperoneLimit), {
    check: (v) => (/^\d+$/.test(v.trim()) ? null : "Enter a number. Use 0 if bands can't bring chaperones."),
  });
  const contactName = useAutosave(eventId, "contactName", initial.contact.name);
  const contactPhone = useAutosave(eventId, "contactPhone", initial.contact.phone, {
    check: (v) => (v.trim() && !normalizePhone(v) ? "Enter a 10-digit phone number." : null),
  });
  const contactEmail = useAutosave(eventId, "contactEmail", initial.contact.email, {
    check: (v) => (v.trim() && !/^\S+@\S+\.\S+$/.test(v.trim()) ? "Enter a full email address." : null),
  });
  const mealsOffered = useAutosave(eventId, "mealsOffered", initial.meals?.offered ? "true" : "false", { immediate: true });
  const mealPrice = useAutosave(eventId, "mealPrice", initial.meals?.priceCents != null ? (initial.meals.priceCents / 100).toFixed(initial.meals.priceCents % 100 ? 2 : 0) : "", {
    check: (v) => (v.trim() && !/^\$?\d{1,4}(\.\d{1,2})?$/.test(v.trim()) ? "Enter a price like 8 or 8.50." : null),
  });
  const mealDetails = useAutosave(eventId, "mealDetails", initial.meals?.details ?? "");
  // The options bands order, saved as a list each time one is added or removed.
  const mealOptions = useAutosave(eventId, "mealOptions", JSON.stringify(initial.meals?.options ?? []), { immediate: true });
  const optionList: string[] = (() => {
    try {
      return JSON.parse(mealOptions.value) as string[];
    } catch {
      return [];
    }
  })();
  const addOptions = (names: string[]) => {
    const next = [...optionList];
    for (const n of names.map((x) => x.trim()).filter(Boolean)) if (!next.some((o) => o.toLowerCase() === n.toLowerCase())) next.push(n);
    mealOptions.change(JSON.stringify(next.slice(0, 10)));
  };
  const fields = [opensOn, deadline, info, pay, chaperones, contactName, contactPhone, contactEmail, mealsOffered, mealPrice, mealDetails, mealOptions];

  // Classifications: added, renamed, and removed one at a time.
  const [list, setList] = useState(initial.classifications);
  const [bandsIn, setBandsIn] = useState(initialBandsIn);
  const [cls, setCls] = useState<{ busy: boolean; failure: Failure; saved: boolean }>({ busy: false, failure: null, saved: false });
  // The last classification change, for Retry when the connection dropped.
  const lastOp = useRef<(() => void) | null>(null);
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const clsKey = useId();
  useEffect(() => {
    // Only a dropped connection leaves something unsaved; a refusal ("already a classification") just says why.
    setPending(clsKey, cls.busy ? { kind: "saving" } : cls.failure?.retry ? { kind: "failed", flush: () => lastOp.current?.() } : null);
    return () => setPending(clsKey, null);
  }, [cls, clsKey]);

  async function run(op: () => Promise<FieldSaveState & { classifications?: string[] }>, after?: () => void): Promise<boolean> {
    lastOp.current = () => void run(op, after);
    setCls({ busy: true, failure: null, saved: false });
    let r: FieldSaveState & { classifications?: string[] };
    try {
      r = await op();
    } catch {
      setCls({ busy: false, failure: { message: CONNECTION, retry: true }, saved: false });
      return false;
    }
    if (r.classifications) setList(r.classifications);
    if (r.error) {
      setCls({ busy: false, failure: { message: r.error, retry: Boolean(r.retry) }, saved: false });
      return false;
    }
    after?.();
    setCls({ busy: false, failure: null, saved: true });
    return true;
  }
  const add = (names: string[]) => {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length && !cls.busy) void run(() => addClassifications(eventId, clean));
  };
  const remove = (name: string) => void run(() => removeClassification(eventId, name));
  const rename = async () => {
    if (!renaming) return;
    const { from, to } = renaming;
    if (!to.trim() || to.trim() === from) return setRenaming(null);
    const ok = await run(
      () => renameClassification(eventId, from, to.trim()),
      () =>
        setBandsIn((b) => {
          const { [from]: n = 0, ...rest } = b;
          return n ? { ...rest, [to.trim()]: n } : rest;
        }),
    );
    if (ok) setRenaming(null);
  };

  /** Takes the person to the first box that didn't save. */
  const showFailed = () => {
    const el = root.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  };

  const saving = counts.saving > 0 || cls.busy;
  const failed = counts.failed > 0;
  const anySaved = cls.saved || fields.some((f) => f.state === "saved");
  const missing = [list.length === 0 && "at least one classification", !deadline.value && "a deadline"].filter(Boolean) as string[];
  const chip = "inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-field-border bg-background text-sm font-semibold";
  const outline =
    "inline-flex min-h-11 items-center rounded-md border-[1.5px] border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand disabled:cursor-not-allowed disabled:text-disabled";

  return (
    <div ref={root} className="rounded-xl border border-border bg-surface shadow-card">
      <div className="space-y-7 p-4 sm:p-6">
        {/* Classifications */}
        <fieldset>
          <legend id="cls-label" className="text-sm font-semibold">
            Classifications<span aria-hidden> *</span>
          </legend>
          <p id="cls-hint" className="mt-1 text-sm text-muted">
            Bands pick one when they register, and the schedule is grouped by these. Use the names your directors know, like
            1A, Class AA, Division I, or Varsity.
          </p>
          {list.length > 0 && (
            <ul className="mt-3 flex flex-wrap items-start gap-2" aria-label="Classifications">
              {list.map((c) => {
                const n = bandsIn[c] ?? 0;
                if (renaming?.from === c)
                  return (
                    <li key={c} className="flex w-full flex-wrap items-center gap-2">
                      <Input
                        autoFocus
                        value={renaming.to}
                        onChange={(e) => setRenaming({ from: c, to: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void rename();
                          }
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        aria-label={`New name for ${c}`}
                        maxLength={40}
                        className="w-48! max-w-full"
                      />
                      <button type="button" disabled={cls.busy} onClick={() => void rename()} className={outline}>
                        Save name
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold underline underline-offset-4">
                        Cancel
                      </button>
                      <p className="basis-full text-sm text-muted">
                        {n > 0 ? `The ${n === 1 ? "band" : `${n} bands`} in ${c} will see the new name. Nobody is emailed.` : "Nobody is emailed."}
                      </p>
                    </li>
                  );
                return (
                  <li key={c} className={chip}>
                    <button
                      type="button"
                      disabled={cls.busy}
                      onClick={() => setRenaming({ from: c, to: c })}
                      aria-label={`Rename ${c}`}
                      className="inline-flex min-h-11 items-center gap-1.5 pl-3 underline decoration-dotted underline-offset-4 hover:decoration-solid"
                    >
                      {c}
                    </button>
                    {n > 0 ? (
                      <span className="pr-3 pl-1 font-normal text-muted">
                        · {n} {n === 1 ? "band" : "bands"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={cls.busy}
                        onClick={() => remove(c)}
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
          {list.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Select a name to rename it.
              {Object.values(bandsIn).some((n) => n > 0) && " A classification with bands in it can't be removed, but it can be renamed."}
            </p>
          )}
          <div className="mt-3">
            <ChipAdder
              suggestions={[
                { title: "1A–6A", names: PRESETS.uil },
                { title: "Division I–III", names: PRESETS.divisions },
              ]}
              existing={list}
              onAdd={(names) => add(names)}
              busy={cls.busy}
              placeholder={list.length ? "Add another" : "Like 1A or Class AA"}
              label="Add a classification"
              describedBy={[cls.failure && "cls-error", "cls-hint"].filter(Boolean).join(" ")}
              invalid={Boolean(cls.failure)}
            />
          </div>
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

        <AutoField
          id="reg-opens"
          label="Registration opens"
          hint={
            alreadyOpen
              ? "Registration is already open, so the opening day can't move later. To pause it, close registration at the top of this page."
              : draft
                ? "Optional. Leave it empty to open registration when you publish. Before this day, your event page is live and the registration page says when it opens."
                : "Optional. Before this day, the registration page says when it opens."
          }
          saver={opensOn}
        >
          <DateField
            value={opensOn.value}
            disabled={alreadyOpen}
            min={initial.opensOn && initial.opensOn < today ? initial.opensOn : today}
            max={deadline.value || contest.lastDeadline}
            onChange={(e) => opensOn.change(e.target.value)}
            {...marked("reg-opens", opensOn)}
            className="max-w-xs"
          />
        </AutoField>

        <AutoField
          id="reg-deadline"
          label="Registration deadline"
          required
          hint={`Pick a date at least two weeks before contest day (${contest.label}). Directors get their times two weeks before contest day, so they can book buses. Registration closes at 11:59 PM that day, your time.`}
          saver={deadline}
        >
          <DateField
            value={deadline.value}
            min={initial.deadline && initial.deadline < today ? initial.deadline : today}
            max={contest.lastDeadline}
            onChange={(e) => deadline.change(e.target.value)}
            {...marked("reg-deadline", deadline)}
            className="max-w-xs"
          />
        </AutoField>

        <AutoField
          id="reg-info"
          label="Information for directors"
          hint="The entry fee and how to pay, where buses park, and warm-up. Shown on the registration page and each band's page."
          saver={info}
        >
          <Textarea value={info.value} onChange={(e) => info.change(e.target.value)} rows={5} maxLength={3000} {...withClass(marked("reg-info", info), "w-full")} />
        </AutoField>

        <AutoField
          id="reg-pay"
          label="Payment link"
          hint="Optional. If directors pay online, paste the full link. It shows as a “Pay the entry fee” button."
          saver={pay}
        >
          <Input type="url" inputMode="url" value={pay.value} onChange={(e) => pay.change(e.target.value)} {...withClass(marked("reg-pay", pay), "w-full")} />
        </AutoField>

        {initial.meals && (
          // Meals for visiting bands: the price and options show above where directors say how many they need.
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold">Meals</legend>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={mealsOffered.value === "true"}
                onChange={(e) => mealsOffered.change(e.target.checked ? "true" : "false")}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="font-medium">We&apos;ll provide meals for visiting bands</span>
                <span className="block text-muted">Directors order meals when they register. You see each order, and the totals, in your band list and download.</span>
                {mealsOffered.failure && (
                  <span role="alert" className="block font-semibold text-danger">
                    Not saved. {mealsOffered.failure.message}
                  </span>
                )}
              </span>
            </label>
            {mealsOffered.value === "true" && (
              <div className="space-y-4 border-l-2 border-border pl-4">
                <AutoField id="reg-meal-price" label="Price per meal" hint="Optional. Shown to directors when they order, with their total. Leave it empty if there's no set price." saver={mealPrice}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="text-sm font-semibold">
                      $
                    </span>
                    <Input
                      inputMode="decimal"
                      value={mealPrice.value}
                      placeholder="8.50"
                      onChange={(e) => mealPrice.change(e.target.value)}
                      {...withClass(marked("reg-meal-price", mealPrice), "w-28!")}
                    />
                  </span>
                </AutoField>
                <fieldset>
                  <legend className="text-sm font-semibold">Meal options</legend>
                  <p className="mt-1 text-sm text-muted">What bands can order. Directors enter how many of each.</p>
                  {optionList.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Meal options">
                      {optionList.map((o) => (
                        <li key={o} className={chip}>
                          <span className="pl-3">{o}</span>
                          <button
                            type="button"
                            onClick={() => mealOptions.change(JSON.stringify(optionList.filter((x) => x !== o)))}
                            aria-label={`Remove ${o}`}
                            className="inline-flex size-11 items-center justify-center rounded-lg text-lg text-muted hover:text-danger"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2">
                    <ChipAdder
                      suggestions={[{ names: ["Regular", "Vegetarian", "Halal", "Gluten free", "Kosher", "Dairy free"] }]}
                      existing={optionList}
                      onAdd={(names) => addOptions(names)}
                      placeholder={optionList.length ? "Add another" : "Like Regular or Vegetarian"}
                      label="Add a meal option"
                      max={10}
                      maxLength={30}
                    />
                  </div>
                  {optionList.length === 0 && <p className="mt-2 text-sm text-muted">With no options, directors enter one number of meals.</p>}
                  {mealOptions.failure && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                      Not saved. {mealOptions.failure.message}
                    </p>
                  )}
                </fieldset>
                <AutoField
                  id="reg-meal-details"
                  label="Meal details"
                  hint="Optional. What's served, when, and how to pay. Shown to directors above their meal order."
                  saver={mealDetails}
                >
                  <Textarea
                    value={mealDetails.value}
                    onChange={(e) => mealDetails.change(e.target.value)}
                    rows={4}
                    maxLength={1000}
                    placeholder="Pizza or a turkey sandwich, chips, and water, served from 11:00 AM. Pay with the entry fee."
                    {...withClass(marked("reg-meal-details", mealDetails), "w-full")}
                  />
                </AutoField>
              </div>
            )}
          </fieldset>
        )}

        <fieldset>
          <legend className="text-sm font-semibold">Contact for directors</legend>
          <p className="mt-1 text-sm text-muted">
            Directors get Call and Text buttons for this person the day before and the day of the contest. Only directors
            who registered for this contest (even if they later withdraw) and your team see it.
            {!contactSaved && " We filled in your details. Change them if someone else handles bands."}
          </p>
          {/* Name and mobile side by side; the email gets a row of its own, so a long address shows in full. */}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <AutoField id="reg-cname" label="Name" saver={contactName}>
              <Input value={contactName.value} onChange={(e) => contactName.change(e.target.value)} autoComplete="name" {...withClass(marked("reg-cname", contactName, false), "w-full")} />
            </AutoField>
            <AutoField id="reg-cphone" label="Mobile" saver={contactPhone}>
              <Input type="tel" inputMode="tel" value={contactPhone.value} onChange={(e) => contactPhone.change(e.target.value)} {...withClass(marked("reg-cphone", contactPhone, false), "w-full")} />
            </AutoField>
            <div className="sm:col-span-2">
              <AutoField id="reg-cemail" label="Email" saver={contactEmail}>
                <Input type="email" value={contactEmail.value} onChange={(e) => contactEmail.change(e.target.value)} {...withClass(marked("reg-cemail", contactEmail, false), "w-full")} />
              </AutoField>
            </div>
          </div>
        </fieldset>

        <AutoField id="reg-chap" label="Chaperone limit per band" hint="The most chaperones a band can bring." saver={chaperones}>
          <NumberInput value={chaperones.value} onChange={(e) => chaperones.change(e.target.value)} maxLength={3} {...withClass(marked("reg-chap", chaperones), "max-w-[8rem]")} />
        </AutoField>
      </div>

      {/* Pinned to the bottom of the screen: whether everything is saved, and the way on. */}
      <div className="sticky bottom-[var(--day-bar,0px)] z-10 rounded-b-xl border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 text-sm" role="status">
            {failed ? (
              <p className="flex flex-wrap items-center gap-x-2 font-semibold text-danger">
                <span>
                  <span aria-hidden>▲ </span>Something isn&apos;t saved.
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
                <span aria-hidden>◆ </span>Something you typed isn&apos;t added yet. Select Add to keep it.
              </p>
            ) : draft && missing.length === 0 ? (
              <p className="font-medium">
                <span aria-hidden className="text-success">
                  ✓{" "}
                </span>
                Saved · Ready to publish
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
            <Link href={next.href} className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
              {next.label} →
            </Link>
          )}
        </div>
        {draft && missing.length > 0 && (
          <p className="mt-1.5 hidden text-sm text-muted sm:block">You can leave and come back. Before you publish, add {missing.join(" and ")}.</p>
        )}
      </div>
    </div>
  );
}

/** Adds layout classes to a box's own (the failed-save marking comes first, so it wins). */
export function withClass<T extends { className: string }>(p: T, extra: string): T {
  return { ...p, className: `${extra} ${p.className}`.trim() };
}
