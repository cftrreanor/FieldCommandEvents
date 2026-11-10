"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useActionState, useState } from "react";
import { ActionPendingContext } from "@/components/action-form";
import { BotCheck } from "@/components/bot-check";
import { NumberInput } from "@/components/number-input";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Button, Card, Field, FormMessage, Input } from "@/components/ui";
import { GUARDIAN_CONSENT, MAX_OTHERS, groupProgress, ineligibleReason, shiftsOverlap } from "@/lib/group-signup";
import type { SignupPayload, SignupState } from "./actions";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";

export type PublicShift = {
  id: string;
  title: string;
  when: string;
  startsAt: string;
  endsAt: string;
  description: string | null;
  spotsLeft: number;
  /** No one under 18 (this shift's own switch, or its sign-up's). */
  adultsOnly: boolean;
  /** For minors: the youngest age allowed. */
  minAge: number | null;
  /** Spots saved for adults (18+) that the shift still needs: under-18s can't take them. */
  adultsNeeded: number;
};
/** Something to bring (Desserts), how many are still needed, and who's bringing what so far. */
export type PublicItem = {
  id: string;
  name: string;
  left: number;
  needed: number;
  /** "Sam (Brownies)", first names only. */
  coming: string[];
};
export type PublicStation = {
  id: string;
  name: string;
  location: string | null;
  instructions: string | null;
  /** No one under 18 on this sign-up's shifts. */
  adults_only: boolean;
  shifts: PublicShift[];
  /** A station of things to bring instead of times. */
  items: PublicItem[];
};

/** Someone the booker adds, each on their own shifts. */
type Person = { key: number; name: string; minor: boolean; age: string; email: string; phone: string; shifts: string[] };
type Step = { kind: "pick"; i: number } | { kind: "details"; i: number } | { kind: "review" };
const BOOKER = -1;

/**
 * The public sign-up, a step at a time: your shifts and details; then, if you
 * like, each person you're adding (their details, then their shifts); then a
 * review of everyone before anything is saved.
 */
export function SignupForm({
  action,
  spots,
  stations,
  disabled,
  lead = "Coordinator",
  keepsHistory = false,
}: {
  action: (prev: SignupState, formData: FormData) => Promise<SignupState>;
  /** Spots left on each shift right now (checked again on the review screen). */
  spots: () => Promise<Record<string, number>>;
  stations: PublicStation[];
  disabled?: boolean;
  /** Who sees volunteers' phone numbers on the day. */
  lead?: string;
  /** The account keeps a 2-year volunteer history (packages with volunteer tracking). */
  keepsHistory?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const pathname = usePathname();
  const [startedAt] = useState(() => Date.now());
  const [step, setStep] = useState<Step>({ kind: "pick", i: BOOKER });
  const [problem, setProblem] = useState<string | null>(null);
  // The booker.
  const [me, setMe] = useState({ name: "", email: "", phone: "", minor: false, age: "" });
  const [mine, setMine] = useState<string[]>([]);
  // Items to bring they've picked, with what they'll bring ("Brownies"). Just for the booker.
  const [pickedItems, setPickedItems] = useState<Map<string, string>>(new Map());
  const [people, setPeople] = useState<Person[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [latest, setLatest] = useState<Record<string, number> | null>(null);
  const [consent, setConsent] = useState(false);

  const hasItems = stations.some((st) => st.items.length > 0);
  const hasShifts = stations.some((st) => st.shifts.length > 0);
  const shiftList = stations.flatMap((st) => st.shifts.map((sh) => ({ ...sh, station: st })));
  const shiftById = new Map(shiftList.map((s) => [s.id, s]));
  const shiftsOf = (who: number) => (who === BOOKER ? mine : (people[who]?.shifts ?? []));
  const ageOf = (who: number) => {
    const p = who === BOOKER ? me : people[who];
    return p?.minor && p.age ? Number(p.age) : null;
  };
  const minorOf = (who: number) => (who === BOOKER ? me.minor : (people[who]?.minor ?? false));
  // Spots left for one person: the shift's open spots, less the rest of the group's picks.
  const spotsFor = (shiftId: string, who: number) => {
    const open = latest?.[shiftId] ?? shiftById.get(shiftId)?.spotsLeft ?? 0;
    const others = [BOOKER, ...people.map((_, j) => j)].filter((j) => j !== who && shiftsOf(j).includes(shiftId)).length;
    return open - others;
  };
  const whyNot = (shiftId: string, who: number) => {
    const s = shiftById.get(shiftId);
    if (!s) return null;
    const rule = ineligibleReason({ minor: minorOf(who), age: ageOf(who) }, s);
    if (rule || !minorOf(who) || !s.adultsNeeded) return rule;
    // Spots saved for adults: adults in this group picking the shift count toward them first, like the server.
    const groupAdults = [BOOKER, ...people.map((_, j) => j)].filter((j) => j !== who && !minorOf(j) && shiftsOf(j).includes(shiftId)).length;
    return spotsFor(shiftId, who) <= Math.max(0, s.adultsNeeded - groupAdults) ? "Open spots are for adults (18+)" : null;
  };
  // A shift that's at the same time as one this person already picked: "Same time as your Concessions shift".
  const clash = (shiftId: string, who: number) => {
    const s = shiftById.get(shiftId);
    const other = s && shiftsOf(who).map((id) => shiftById.get(id)).find((o) => o && o.id !== shiftId && shiftsOverlap(o, s));
    if (!other) return null;
    return `Same time as ${who === BOOKER ? "your" : `${firstName(who)}'s`} ${other.station.name} shift`;
  };
  // Why a shift can't be ticked for this person right now.
  const blockedFor = (shiftId: string, who: number) => whyNot(shiftId, who) ?? clash(shiftId, who);
  const firstName = (who: number) => (who === BOOKER ? "you" : people[who]?.name.trim().split(/\s+/)[0] || "them");
  const anyMinor = me.minor || people.some((p) => p.minor);

  const goReview = async () => {
    setProblem(null);
    setStep({ kind: "review" });
    setLatest(await spots());
  };
  const addPerson = () => {
    setPeople((prev) => [...prev, { key: nextKey, name: "", minor: false, age: "", email: "", phone: "", shifts: [] }]);
    setNextKey((n) => n + 1);
    setStep({ kind: "details", i: people.length });
  };
  const removePerson = (i: number) => {
    setPeople((prev) => prev.filter((_, j) => j !== i));
    setStep({ kind: "review" });
  };
  const setPerson = (i: number, change: Partial<Person>) => setPeople((prev) => prev.map((p, j) => (j === i ? { ...p, ...change } : p)));

  if (state.confirmed) return <Confirmed confirmed={state.confirmed} pathname={pathname} />;

  // The group's count shows once someone's been added.
  const progress = people.length > 0 && (
    <p className="flex items-center gap-2 rounded-md bg-brand-soft px-3 py-2 text-sm font-semibold" aria-live="polite">
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: MAX_OTHERS + 1 }, (_, n) => (
          <span key={n} className={`size-2.5 rounded-full ${n <= people.length ? "bg-brand" : "bg-border"}`} />
        ))}
      </span>
      {groupProgress(people.length)}
    </p>
  );

  // The two ways on from a person's shifts.
  const nextButtons = (who: number) => (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="next" value="finish" disabled={disabled}>
          Review and confirm
        </Button>
        {people.length < MAX_OTHERS && (
          <Button type="submit" name="next" value="add" variant="secondary" disabled={disabled}>
            Save and add another person
          </Button>
        )}
      </div>
      {people.length >= MAX_OTHERS && (
        <p className="text-sm text-muted">
          That&apos;s the most for one sign-up: you and {MAX_OTHERS} others. To sign up more people, start a new sign-up after this one.
        </p>
      )}
      {who !== BOOKER && (
        <p className="text-sm">
          <button type="button" className="font-medium text-danger underline-offset-4 hover:underline" onClick={() => removePerson(who)}>
            Remove {firstName(who)}
          </button>
        </p>
      )}
    </div>
  );

  // After a person's shifts: on to the review, or the next person.
  const onPicked = (who: number) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (who === BOOKER && mine.length === 0 && pickedItems.size === 0) return setProblem("Pick at least one shift or item above.");
    if (who === BOOKER && next === "add" && mine.length === 0) return setProblem("Pick a shift for yourself first. Then you can add other people.");
    if (who !== BOOKER && shiftsOf(who).length === 0) return setProblem(`Pick at least one shift for ${firstName(who)}.`);
    const overlap = shiftsOf(who).find((id) => clash(id, who));
    if (overlap) {
      const s = shiftById.get(overlap)!;
      return setProblem(`${who === BOOKER ? "You have" : `${firstName(who)} has`} two shifts at the same time (${s.station.name}, ${s.when}). Untick one to go on.`);
    }
    setProblem(null);
    if (next === "add") addPerson();
    else void goReview();
  };

  // -------------------------------------------------------------------------
  // A person's details (someone being added).
  if (step.kind === "details") {
    const i = step.i;
    const p = people[i];
    return (
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          setProblem(null);
          setStep({ kind: "pick", i });
        }}
      >
        {progress}
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="text-xl font-semibold">Who are you adding?</h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={p.minor}
              onChange={(e) => setPerson(i, { minor: e.target.checked })}
              className="h-5 w-5 accent-[var(--brand)]"
            />
            Under 18
          </label>
          <Field label={p.minor ? "First name and last initial" : "Full name"} hint={p.minor ? "For example, Maya O. We only keep their last initial." : undefined}>
            <Input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} required maxLength={200} autoComplete="off" />
          </Field>
          {p.minor && (
            <Field label="How old are they?" hint="Some shifts have a minimum age.">
              <div className="w-24">
                <NumberInput value={p.age} onChange={(e) => setPerson(i, { age: e.target.value })} required maxLength={2} />
              </div>
            </Field>
          )}
          <Field label="Their email (optional)" hint="We'll send them their own confirmation, with a link to change or cancel their spot.">
            <Input type="email" inputMode="email" value={p.email} onChange={(e) => setPerson(i, { email: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Their cell phone (optional)" hint={`Without one, their ${lead} gets your number. Only the people running this event see it, and only on event day.`}>
            <Input type="tel" inputMode="tel" value={p.phone} onChange={(e) => setPerson(i, { phone: e.target.value })} autoComplete="off" />
          </Field>
        </Card>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Next: pick {p.name.trim() ? `${p.name.trim().split(/\s+/)[0]}'s` : "their"} shifts</Button>
          <Button type="button" variant="ghost" onClick={() => (p.shifts.length || p.name ? setStep({ kind: "review" }) : removePerson(i))}>
            {p.shifts.length || p.name ? "Back to review" : "Cancel"}
          </Button>
        </div>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // Someone else's shifts.
  if (step.kind === "pick" && step.i !== BOOKER) {
    const i = step.i;
    const p = people[i];
    const name = firstName(i);
    const sameBlocked = mine.map((id) => whyNot(id, i) ?? (spotsFor(id, i) <= 0 ? "Full" : null)).find(Boolean) ?? null;
    const same = mine.length > 0 && p.shifts.length === mine.length && mine.every((id) => p.shifts.includes(id));
    const toggle = (id: string) =>
      setPerson(i, { shifts: p.shifts.includes(id) ? p.shifts.filter((x) => x !== id) : [...p.shifts, id] });
    return (
      <form className="space-y-6" onSubmit={onPicked(i)}>
        {progress}
        <div>
          <h2 className="text-xl font-semibold">{p.name.trim() || "Their"}&apos;s shifts</h2>
          <p className="mt-1 text-sm text-muted">
            {p.minor ? `${name} is ${p.age || "under 18"}, so shifts for older volunteers are greyed out.` : "Pick as many as they like, as long as the times don't overlap."}
          </p>
        </div>
        {mine.length > 0 && (
          <label
            className={`flex min-h-14 items-start gap-3 rounded-lg border border-dashed px-3 py-3 ${
              sameBlocked && !same ? "cursor-not-allowed border-border bg-background opacity-60" : same ? "border-brand bg-brand-soft" : "cursor-pointer border-border hover:border-brand"
            }`}
          >
            <input
              type="checkbox"
              checked={same}
              disabled={Boolean(sameBlocked) && !same}
              onChange={() => setPerson(i, { shifts: same ? [] : [...mine] })}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
            />
            <span className="min-w-0">
              <span className="block font-semibold">Same shifts as you</span>
              <span className="block text-sm text-muted">
                {mine.map((id) => `${shiftById.get(id)?.station.name}, ${shiftById.get(id)?.when}`).join("; ")}
              </span>
              {sameBlocked && !same && (
                <span className="block text-sm font-medium">
                  Not available for {name}: {sameBlocked === "Full" ? "a shift is full" : sameBlocked.toLowerCase()}
                </span>
              )}
            </span>
          </label>
        )}
        {mine.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-muted">Or pick different shifts</p>}
        {stations
          .filter((st) => st.shifts.length > 0)
          .map((st) => (
            <Card key={st.id} className="p-4 sm:p-5">
              <h3 className="font-semibold">{st.name}</h3>
              {st.location && <p className="text-sm text-muted">{st.location}</p>}
              <ShiftChoices shifts={st.shifts} chosen={p.shifts} onToggle={toggle} spotsFor={(id) => spotsFor(id, i)} whyNot={(id) => blockedFor(id, i)} disabled={disabled} />
            </Card>
          ))}
        <FormMessage error={problem} />
        {nextButtons(i)}
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // The review: everyone, before anything is saved.
  if (step.kind === "review") {
    // Walk the group in order: once a shift's spots are used up, later people on it are flagged.
    const used = new Map<string, number>();
    const flags = new Map<number, string[]>();
    for (const who of [BOOKER, ...people.map((_, j) => j)]) {
      for (const id of shiftsOf(who)) {
        const open = latest?.[id] ?? shiftById.get(id)?.spotsLeft ?? 0;
        const n = (used.get(id) ?? 0) + 1;
        used.set(id, n);
        const why = whyNot(id, who);
        if (n > open || why) flags.set(who, [...(flags.get(who) ?? []), id]);
      }
    }
    const blocked = flags.size > 0 || !latest;
    const everyone = 1 + people.length;
    const payload: SignupPayload = {
      booker: { name: me.name, email: me.email, phone: me.phone, minor: me.minor, age: me.minor && me.age ? Number(me.age) : null },
      shiftIds: mine,
      items: [...pickedItems.entries()].map(([item, note]) => ({ item, note })),
      people: people.map((p) => ({
        name: p.name,
        minor: p.minor,
        age: p.minor && p.age ? Number(p.age) : null,
        email: p.email.trim(),
        phone: p.phone.trim(),
        shiftIds: p.shifts,
      })),
      consent,
    };
    const row = (who: number) => {
      const p = who === BOOKER ? null : people[who];
      const theirFlags = flags.get(who) ?? [];
      return (
        <li key={p?.key ?? "me"} className="space-y-1 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-semibold">
              {who === BOOKER ? `${me.name} (you)` : p!.name}
              {minorOf(who) && (
                <span className="ml-2 align-middle">
                  <Badge tone="warning">Under 18</Badge>
                </span>
              )}
            </p>
            {p?.email.trim() && <p className="text-sm text-muted">{p.email.trim()}</p>}
          </div>
          <ul className="text-sm">
            {shiftsOf(who).map((id) => (
              <li key={id}>
                <span className="font-medium">{shiftById.get(id)?.station.name}</span>{" "}
                <span className="text-muted">· {shiftById.get(id)?.when}</span>
              </li>
            ))}
            {who === BOOKER &&
              stations
                .flatMap((st) => st.items.filter((it) => pickedItems.has(it.id)).map((it) => ({ st, it })))
                .map(({ st, it }) => (
                  <li key={it.id}>
                    <span className="font-medium">Bringing {it.name}</span>{" "}
                    <span className="text-muted">· {[st.name, pickedItems.get(it.id)].filter(Boolean).join(": ")}</span>
                  </li>
                ))}
          </ul>
          {theirFlags.map((id) => (
            <p key={id} className="rounded-md bg-danger/5 px-2 py-1 text-sm font-medium text-danger">
              {whyNot(id, who)
                ? `${shiftById.get(id)?.station.name} is ${whyNot(id, who)!.toLowerCase()}. Pick another shift for ${firstName(who)}.`
                : `${shiftById.get(id)?.station.name} (${shiftById.get(id)?.when}) just filled up. Pick another shift for ${firstName(who)}.`}
            </p>
          ))}
          <p className="flex flex-wrap gap-x-4 text-sm font-medium">
            <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => setStep({ kind: "pick", i: who })}>
              {theirFlags.length ? "Pick another shift" : "Edit"}
            </button>
            {who !== BOOKER && (
              <button type="button" className="text-brand underline-offset-4 hover:underline" onClick={() => setStep({ kind: "details", i: who })}>
                Edit details
              </button>
            )}
            {who !== BOOKER && (
              <button type="button" className="text-danger underline-offset-4 hover:underline" onClick={() => removePerson(who)}>
                Remove
              </button>
            )}
          </p>
        </li>
      );
    };
    return (
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <ActionPendingContext value={pending}>
          <input type="hidden" name="startedAt" value={startedAt} />
          <input type="hidden" name="payload" value={JSON.stringify(payload)} />
          {/* Bot trap: hidden from people, tempting to scripts. */}
          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label>
              Website <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {progress}
          <div>
            <h2 className="text-xl font-semibold">{people.length ? "Last step: check everyone and confirm" : "Last step: check and confirm"}</h2>
            <p className="mt-1 text-sm text-muted">Nothing is saved until you confirm.</p>
          </div>
          <Card className="p-0">
            <ul className="divide-y divide-border">{[BOOKER, ...people.map((_, j) => j)].map(row)}</ul>
          </Card>
          {people.length < MAX_OTHERS ? (
            <Button type="button" variant="secondary" onClick={addPerson}>
              + Add another person
            </Button>
          ) : (
            <p className="text-sm text-muted">That&apos;s the most for one sign-up: you and {MAX_OTHERS} others.</p>
          )}
          {anyMinor && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
              />
              <span>{GUARDIAN_CONSENT}</span>
            </label>
          )}
          <BotCheck />
          <FormMessage error={state.error} />
          <SubmitButton className="w-full text-base" disabled={disabled || blocked || (anyMinor && !consent)} pendingText="Signing everyone up…">
            {everyone === 1 ? "Confirm sign-up" : `Confirm sign-up for ${everyone} people`}
          </SubmitButton>
          {!latest ? (
            <p className="text-center text-sm text-muted">Checking open spots…</p>
          ) : flags.size > 0 ? (
            <p className="text-center text-sm text-muted">Pick a new shift for anyone flagged above to confirm.</p>
          ) : anyMinor && !consent ? (
            <p className="text-center text-sm text-muted">Tick the box above to confirm.</p>
          ) : null}
          <p className="text-center text-xs text-muted">
            Contact details are shared only with the event team.{hasItems ? " If you bring something, others see your first name and what you're bringing." : ""}{" "}
            {keepsHistory
              ? "Phone numbers are deleted 10 days after the event; the organizer keeps adults' names, emails, and how many shifts each person volunteered until 2 years after their last event, to thank and invite back returning volunteers."
              : "Everyone's details are deleted 10 days after the event."}
          </p>
        </ActionPendingContext>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  // The booker: their shifts (and items), and their details.
  return (
    <BookerStep
      stations={stations}
      hasItems={hasItems}
      hasShifts={hasShifts}
      mine={mine}
      setMine={setMine}
      pickedItems={pickedItems}
      setPickedItems={setPickedItems}
      me={me}
      setMe={setMe}
      spotsFor={(id) => spotsFor(id, BOOKER)}
      whyNot={(id) => blockedFor(id, BOOKER)}
      progress={progress}
      problem={problem}
      onSubmit={onPicked(BOOKER)}
      buttons={nextButtons(BOOKER)}
      disabled={disabled}
      grouped={people.length > 0}
    />
  );
}

function BookerStep({
  stations,
  hasItems,
  hasShifts,
  mine,
  setMine,
  pickedItems,
  setPickedItems,
  me,
  setMe,
  spotsFor,
  whyNot,
  progress,
  problem,
  onSubmit,
  buttons,
  disabled,
  grouped,
}: {
  stations: PublicStation[];
  hasItems: boolean;
  hasShifts: boolean;
  mine: string[];
  setMine: (fn: (prev: string[]) => string[]) => void;
  pickedItems: Map<string, string>;
  setPickedItems: (fn: (prev: Map<string, string>) => Map<string, string>) => void;
  me: { name: string; email: string; phone: string; minor: boolean; age: string };
  setMe: (fn: (prev: { name: string; email: string; phone: string; minor: boolean; age: string }) => typeof prev) => void;
  spotsFor: (shiftId: string) => number;
  whyNot: (shiftId: string) => string | null;
  progress: React.ReactNode;
  problem: string | null;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  buttons: React.ReactNode;
  disabled?: boolean;
  grouped: boolean;
}) {
  const [activeId, setActiveId] = useState(stations[0]?.id);
  // Tabs only once there are six or more jobs; up to five sit one under the other, so none hides.
  const tabbed = stations.length > 5;
  const toggle = (id: string) => setMine((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleItem = (id: string) =>
    setPickedItems((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "");
      return next;
    });
  const set = (change: Partial<typeof me>) => setMe((prev) => ({ ...prev, ...change }));

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {hasShifts && (
        <div className="space-y-2">
          <p className="text-sm">You can sign up yourself and up to {MAX_OTHERS} other people.</p>
          {progress}
        </div>
      )}
      <section aria-labelledby="pick">
        <h2 id="pick" className="text-xl font-semibold">
          {hasItems ? (hasShifts ? "1. Pick what you'll do" : "1. Pick what you'll bring") : "1. Pick your shifts"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {hasShifts && "Choose as many shifts as you like, as long as the times don't overlap."}
          {hasShifts && hasItems && " "}
          {hasItems && "Pick something to bring. Everyone can see what's still needed."}
        </p>

        {tabbed && (
          // Wider screens: a tab per station. Phones list every sign-up instead, so none hide off the edge.
          <div role="group" aria-label="Jobs" className="relative mt-4 hidden overflow-x-auto pt-1 sm:block">
            <div className={folderTabRow}>
              {stations.map((st) => {
                const active = st.id === activeId;
                const open = st.shifts.reduce((n, sh) => n + Math.max(sh.spotsLeft, 0), 0) + st.items.reduce((n, it) => n + Math.max(it.left, 0), 0);
                const picked = st.shifts.filter((sh) => mine.includes(sh.id)).length + st.items.filter((it) => pickedItems.has(it.id)).length;
                return (
                  <button
                    key={st.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setActiveId(st.id)}
                    className={folderTab(active)}
                  >
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      {st.name}
                      {picked > 0 && <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground">{picked}</span>}
                    </span>
                    <span className={folderTabNote()}>
                      {open > 0 ? (st.items.length ? `${open} still needed` : `${open} open spot${open === 1 ? "" : "s"}`) : st.items.length ? "All covered" : "Full"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* On phones every sign-up is shown, so none hide behind a tab. */}
        {stations.map((st) => (
          <Card
            key={st.id}
            id={`panel-${st.id}`}
            className={`mt-4 p-4 sm:p-5 ${tabbed && st.id !== activeId ? "sm:hidden" : ""}`}
          >
            <h3 className="font-semibold">
              {st.name}
              {st.adults_only && (
                <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-xs font-semibold ring-1 ring-border">Adults only (18+)</span>
              )}
            </h3>
            {st.location && <p className="text-sm text-muted">{st.location}</p>}
            {st.instructions && <p className="mt-2 text-sm leading-6 text-muted">{st.instructions}</p>}
            {st.items.length > 0 && (
              <ul className="mt-3 space-y-2">
                {st.items.map((it) => {
                  const isPicked = pickedItems.has(it.id);
                  const covered = it.left <= 0 && !isPicked;
                  const adultsOnly = st.adults_only && me.minor && !isPicked;
                  return (
                    <li key={it.id} className={`rounded-lg border px-3 py-2.5 ${isPicked ? "border-brand bg-brand-soft" : "border-border"}`}>
                      <label className={`flex min-h-11 items-center gap-3 ${covered || adultsOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={isPicked}
                          disabled={covered || adultsOnly || disabled}
                          onChange={() => toggleItem(it.id)}
                          className="h-5 w-5 shrink-0 accent-[var(--brand)]"
                        />
                        <span className="min-w-0 flex-1 font-medium">{it.name}</span>
                        <span className="shrink-0 text-sm font-medium">{it.left <= 0 ? "Covered" : `${it.left} of ${it.needed} still needed`}</span>
                      </label>
                      {isPicked && (
                        <Input
                          value={pickedItems.get(it.id) ?? ""}
                          onChange={(e) => setPickedItems((prev) => new Map(prev).set(it.id, e.target.value))}
                          placeholder="What are you bringing? (optional)"
                          aria-label={`What are you bringing for ${it.name}?`}
                          maxLength={200}
                          autoComplete="off"
                          className="mt-2"
                        />
                      )}
                      {it.coming.length > 0 && <p className="mt-1 text-sm text-muted">Coming: {it.coming.join(", ")}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            {st.shifts.length > 0 && <ShiftChoices shifts={st.shifts} chosen={mine} onToggle={toggle} spotsFor={spotsFor} whyNot={whyNot} disabled={disabled} />}
          </Card>
        ))}
      </section>

      <section aria-labelledby="you">
        <h2 id="you" className="text-xl font-semibold">
          2. Your details
        </h2>
        <Card className="mt-4 space-y-4 p-4 sm:p-5">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={me.minor} onChange={(e) => set({ minor: e.target.checked })} className="h-5 w-5 accent-[var(--brand)]" />
            I&apos;m under 18
          </label>
          <Field label={me.minor ? "First name and last initial" : "Full name"} hint={me.minor ? "For example, Emma R. We only keep your last initial." : undefined}>
            <Input value={me.name} onChange={(e) => set({ name: e.target.value })} autoComplete={me.minor ? "off" : "name"} required maxLength={200} />
          </Field>
          {me.minor && (
            <Field label="How old are you?" hint="Some shifts have a minimum age.">
              <div className="w-24">
                <NumberInput value={me.age} onChange={(e) => set({ age: e.target.value })} required maxLength={2} />
              </div>
            </Field>
          )}
          <Field label={me.minor ? "Parent or guardian's email" : "Email"} hint="We'll send the confirmation here.">
            <Input type="email" inputMode="email" autoComplete="email" required value={me.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field
            label={me.minor ? "Parent or guardian's cell phone" : "Cell phone"}
            hint={
              grouped
                ? `Also used for anyone you add without their own number. Only the people running this event see it, and only on event day.`
                : `Only the people running this event see it, and only on event day.`
            }
          >
            <Input type="tel" inputMode="tel" autoComplete="tel" required value={me.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
        </Card>
      </section>

      <div className="space-y-3">
        <FormMessage error={problem} />
        {buttons}
      </div>
    </form>
  );
}

/** One sign-up's shifts to tick, with what's full or not allowed greyed out and why. */
function ShiftChoices({
  shifts,
  chosen,
  onToggle,
  spotsFor,
  whyNot,
  disabled,
}: {
  shifts: PublicShift[];
  chosen: string[];
  onToggle: (id: string) => void;
  spotsFor: (id: string) => number;
  whyNot: (id: string) => string | null;
  disabled?: boolean;
}) {
  return (
    <ul className="mt-3 space-y-2">
      {shifts.map((s) => {
        const isChosen = chosen.includes(s.id);
        const left = spotsFor(s.id);
        const full = left <= 0 && !isChosen;
        const reason = isChosen ? null : whyNot(s.id);
        const off = full || Boolean(reason);
        return (
          <li key={s.id}>
            <label
              className={`flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                off ? "cursor-not-allowed border-border bg-background opacity-60" : isChosen ? "cursor-pointer border-brand bg-brand-soft" : "cursor-pointer border-border hover:border-brand"
              }`}
            >
              <input
                type="checkbox"
                checked={isChosen}
                disabled={off || disabled}
                onChange={() => onToggle(s.id)}
                className="h-5 w-5 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.when}</span>
                <span className="block text-sm text-muted">
                  {s.title}
                  {s.description ? ` · ${s.description}` : ""}
                </span>
                {reason && <span className="block text-sm font-semibold">{reason}</span>}
                {!reason && s.adultsNeeded > 0 && left > 0 && (
                  <span className="block text-sm font-medium">
                    {Math.min(s.adultsNeeded, left)} of these saved for adults (18+)
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm font-medium">{left <= 0 && !isChosen ? "Full" : `${Math.max(left, 0)} left`}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function Confirmed({ confirmed: c, pathname }: { confirmed: NonNullable<SignupState["confirmed"]>; pathname: string }) {
  return (
    <Card className="space-y-4" role="status">
      <h2 className="text-xl font-semibold">{c.people.length ? "Everyone's signed up" : "You're signed up"}</h2>
      {c.items.length > 0 && (
        <div>
          <p className="text-sm font-semibold">You&apos;re bringing</p>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
            {c.items.map((it) => (
              <li key={it.station + it.name} className="px-4 py-3">
                <p className="font-medium">{it.name}</p>
                <p className="text-sm text-muted">{[it.station, it.note].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.shifts.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {c.shifts.map((s) => (
            <li key={s.title + s.detail} className="px-4 py-3">
              <p className="font-medium">{s.title}</p>
              <p className="text-sm text-muted">{s.detail}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
                <a href={s.googleUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
                  Add to Google Calendar
                </a>
                <a href={s.icsUrl} className="font-medium text-brand underline-offset-4 hover:underline">
                  Apple / Outlook calendar
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
      {c.people.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Also signed up</p>
          <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
            {c.people.map((p) => (
              <li key={p.name} className="px-4 py-3">
                <p className="font-medium">{p.name}</p>
                {p.shifts.map((s) => (
                  <p key={s} className="text-sm text-muted">
                    {s}
                  </p>
                ))}
                <p className="mt-1 text-sm">
                  {p.emailed ? `We emailed ${p.emailed} their own confirmation, with a link to change or cancel.` : "No email for them, so please pass on their shift details."}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.alreadySignedUp > 0 && (
        <p className="text-sm text-muted">
          {c.alreadySignedUp === 1 ? "One shift was" : `${c.alreadySignedUp} shifts were`} already booked under this email, so we left{" "}
          {c.alreadySignedUp === 1 ? "it" : "them"} as is.
        </p>
      )}
      <p className="leading-7 text-muted">
        {c.emailSent ? (
          <>
            We emailed a confirmation{c.shifts.length ? " with calendar invites" : ""} to <strong className="text-foreground">{c.email}</strong>.
          </>
        ) : c.shifts.length === 0 && c.items.length === 0 && c.people.length === 0 ? (
          <>Your confirmation email went out when you first signed up.</>
        ) : (
          <>Save this page or take a screenshot so you have your sign-up.</>
        )}{" "}
        This device will remember your signup, so you can come back anytime to view or cancel it. No login needed.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href={`/my?as=${encodeURIComponent(c.email)}`}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
        >
          Go to My volunteering
        </Link>
        {/* A full reload brings back a fresh form with up-to-date open spots. */}
        <a href={pathname} className="inline-flex min-h-11 items-center rounded-md border border-brand px-4 text-sm font-medium text-brand hover:bg-brand-soft">
          Sign up for more
        </a>
      </div>
    </Card>
  );
}
