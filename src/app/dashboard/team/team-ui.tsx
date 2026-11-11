"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CopyLink } from "@/components/copy-link";
import { SubmitButton } from "@/components/submit-button";
import { Button, Field, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** The secondary look for a row's buttons: 44 px tall, 14 px words (L12). */
export const ROW_BUTTON = "min-h-11 px-3 text-sm";

/**
 * After a row is removed, keep keyboard and screen-reader users in place: focus moves to the
 * heading of the section the row was in (the row itself is gone), not the top of the page.
 */
export function focusSection(from: HTMLElement | null) {
  const heading = from?.closest("section")?.querySelector<HTMLElement>("h2") ?? document.querySelector<HTMLElement>("main h1");
  if (!heading) return;
  heading.tabIndex = -1;
  requestAnimationFrame(() => heading.focus());
}

/** A window opened by a button, closed by Escape, a click outside, or its way-out button. */
export function useWindow() {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(0);
  return {
    ref,
    key,
    open: () => {
      // A fresh form each time it opens.
      setKey((k) => k + 1);
      ref.current?.showModal();
    },
    close: () => ref.current?.close(),
  };
}

export function Window({
  dialogRef,
  formKey,
  close,
  title,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  formKey: number;
  close: () => void;
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Opening rebuilds the form (a fresh one each time), which drops the focus showModal() gave it: put it on the
  // window's question, so screen readers hear it and keyboards start inside the window.
  useEffect(() => {
    if (formKey && dialogRef.current?.open) heading.current?.focus();
  }, [formKey, dialogRef]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={id}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="team-window m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border p-0 text-left text-foreground shadow-elevated"
    >
      <div key={formKey} className="p-6">
        <h2 id={id} ref={heading} tabIndex={-1} className="text-lg font-semibold leading-7 outline-none [overflow-wrap:anywhere]">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}

/** "Invite a co-host": the one filled button on the page, or a greyed-out one saying why not. */
export function InviteCoHostButton({
  action,
  spotNote,
  blockedBy,
  powers,
  hint,
  candidates,
}: {
  action: Action;
  spotNote: string;
  blockedBy: string | null;
  powers: string;
  /** Pointing to one-event roles, for someone who only needs help with one event. */
  hint?: string;
  /** When the team is full: the people already on it who can be made a co-host (they take no new spot). */
  candidates?: { email: string; name: string; role: string }[] | null;
}) {
  const { ref, key, open, close } = useWindow();
  const full = !!candidates;
  if (blockedBy) {
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          aria-disabled
          aria-describedby="invite-co-host-blocked"
          className="inline-flex min-h-11 cursor-not-allowed items-center rounded-md border border-border px-4 text-sm font-semibold text-disabled"
        >
          Invite a co-host
        </button>
        <p id="invite-co-host-blocked" className="text-sm text-muted">
          {blockedBy}
        </p>
      </div>
    );
  }
  return (
    <>
      <Button type="button" onClick={open}>
        {full ? "Make someone a co-host" : "Invite a co-host"}
      </Button>
      <Window dialogRef={ref} formKey={key} close={close} title={full ? "Make someone a co-host" : "Invite a co-host"}>
        <p className="mt-2 text-sm leading-6">{powers}</p>
        {hint && <p className="mt-2 text-sm leading-6 text-muted">{hint}</p>}
        <ActionForm action={action} onSuccess={close} className="mt-4 space-y-4">
          {full ? (
            // A full team: pick someone already on it (no typing, and no new spot).
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm leading-6">
                <span className="font-medium">Your team is full.</span> Choose someone already on it. It doesn&apos;t take another team spot.
              </legend>
              {candidates.map((c) => (
                <label key={c.email} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-background">
                  <input type="radio" name="email" value={c.email} required className="team-radio" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.role}</span>
                  </span>
                </label>
              ))}
              <p className="px-2 pt-1 text-sm leading-6 text-muted">We&apos;ll email them a link. They become a co-host when they accept.</p>
            </fieldset>
          ) : (
            <Field label="Their email" hint={spotNote}>
              <Input name="email" type="email" required autoComplete="off" inputMode="email" />
            </Field>
          )}
          <WindowButtons keep="Not now" close={close}>
            <SubmitButton pendingText="Sending…" data-solid>
              {full ? "Invite as co-host" : "Send invitation"}
            </SubmitButton>
          </WindowButtons>
        </ActionForm>
      </Window>
    </>
  );
}

/** A row's plain button that runs one action (Resend), with a question first when given. */
export function RowButton({
  action,
  children,
  pendingText,
  confirm,
  confirmLabel,
  label,
  primary = false,
}: {
  action: Action;
  children: ReactNode;
  pendingText: string;
  /** The one filled button in its spot (Accept). */
  primary?: boolean;
  /** "The question? What happens." */
  confirm?: string;
  confirmLabel?: string;
  label?: string;
}) {
  return (
    <ActionForm action={action} confirmMessage={confirm} confirmLabel={confirmLabel} resetOnSuccess={false} className="contents">
      <SubmitButton variant={primary ? "primary" : "secondary"} pendingText={pendingText} className={ROW_BUTTON} aria-label={label}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

/**
 * A row button that asks first, in the same window as Remove…: the question as the title, what
 * happens as bullets, a way out that names what you keep, and a red button for taking access away.
 */
export function ConfirmButton({
  action,
  children,
  label,
  title,
  points,
  keepLabel,
  confirmLabel,
  pendingText,
  danger = true,
  notifyLabel,
}: {
  action: Action;
  /** The row button's words. */
  children: ReactNode;
  /** Its spoken name, starting with the same words. */
  label?: string;
  title: string;
  points: ReactNode[];
  keepLabel: string;
  confirmLabel: string;
  pendingText: string;
  /** Red for anything that takes access away (the default). */
  danger?: boolean;
  /** "Let Priya know by email": a box, ticked, that emails the person removed. */
  notifyLabel?: string;
}) {
  const { ref, key, open, close } = useWindow();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} type="button" variant="secondary" className={ROW_BUTTON} onClick={open} aria-label={label}>
        {children}
      </Button>
      <Window dialogRef={ref} formKey={key} close={close} title={title}>
        <ActionForm
          action={action}
          onSuccess={() => {
            close();
            if (danger) focusSection(trigger.current);
          }}
          resetOnSuccess={false}
          className="mt-3 space-y-4"
        >
          <Points items={points} />
          {notifyLabel && <NotifyBox label={notifyLabel} />}
          <WindowButtons keep={keepLabel} close={close}>
            <SubmitButton variant={danger ? "warn" : "primary"} pendingText={pendingText} data-solid>
              {confirmLabel}
            </SubmitButton>
          </WindowButtons>
        </ActionForm>
      </Window>
    </>
  );
}

/** "Let Marcus know by email": ticked to start; the email says who removed them and who to ask. */
export function NotifyBox({ label }: { label: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
      <input type="checkbox" name="notify" defaultChecked className="size-4 shrink-0 accent-[var(--brand)]" />
      {label}
    </label>
  );
}

/** What happens, as short bullets in body text. */
export function Points({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** The way out (outlined, naming what you keep), then the action. */
export function WindowButtons({ keep, close, children }: { keep: string; close: () => void; children: ReactNode }) {
  return (
    // On phones: full width, the action on top; wider: one row, the way out first.
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
      <Button type="button" variant="secondary" onClick={close}>
        {keep}
      </Button>
      {children}
    </div>
  );
}

/** Copy link, on every invitation: for sending it yourself when the email didn't arrive. */
export function CopyInviteLink({ url, email }: { url: string; email: string }) {
  return (
    <CopyLink
      url={url}
      label="Copy link"
      ariaLabel={`Copy link for ${email}`}
      className={`inline-flex items-center justify-center rounded-md border border-field-border bg-surface font-semibold hover:border-brand hover:bg-background ${ROW_BUTTON}`}
    />
  );
}

export type RemoveChoice = {
  /** "eventId:role" */
  value: string;
  /** "Volunteer Lead · Lone Star Marching Invitational" */
  label: string;
  /** What's left empty: "Ring toss will need a new Coordinator." */
  leaves: string[];
};

/**
 * "Remove…": one quiet button per person. The window names each role, what removing it leaves
 * empty, and what stays; the red button says exactly what it removes.
 */
export function RemovePersonButton({
  name,
  firstName,
  choices,
  action,
  limited = true,
}: {
  name: string;
  firstName: string;
  choices: RemoveChoice[];
  action: Action;
  /** The plan limits team spots, so the window says whether one opens up. */
  limited?: boolean;
}) {
  const { ref, key, open, close } = useWindow();
  const trigger = useRef<HTMLButtonElement>(null);
  const one = choices.length === 1;
  // With more than one role, nothing is picked to start: the biggest choice is never the default.
  const [pick, setPick] = useState<string>(one ? choices[0].value : "");
  const chosen = pick === "all" ? choices : choices.filter((c) => c.value === pick);
  const kept = pick === "all" ? [] : choices.filter((c) => c.value !== pick);
  const leaves = chosen.flatMap((c) => c.leaves);
  const events = new Set(chosen.map((c) => c.value.split(":")[0])).size;
  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        className={ROW_BUTTON}
        aria-label={`Remove… ${name}`}
        onClick={() => {
          setPick(one ? choices[0].value : "");
          open();
        }}
      >
        Remove…
      </Button>
      <Window dialogRef={ref} formKey={key} close={close} title={one ? `Remove ${name} as ${choices[0].label}?` : `Remove ${name}?`}>
        <ActionForm
          action={action}
          onSuccess={() => {
            close();
            focusSection(trigger.current);
          }}
          className="mt-3 space-y-4"
        >
          {/* Exactly the roles listed here: "every role" never reaches past events or roles added since. */}
          {chosen.map((c) => (
            <input key={c.value} type="hidden" name="pick" value={c.value} />
          ))}
          {!one && (
            <fieldset className="space-y-1">
              <legend className="mb-1 text-sm font-medium">Remove {firstName} from</legend>
              {[{ value: "all", label: `Every role below (${choices.length})`, leaves: [] }, ...choices].map((c) => (
                <label key={c.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-background">
                  <input
                    type="radio"
                    name="choice"
                    value={c.value}
                    checked={pick === c.value}
                    onChange={() => setPick(c.value)}
                    className="team-radio"
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>
          )}
          {!pick ? (
            <p className="text-sm leading-6 text-muted">Choose what to remove {firstName} from, and this says what happens.</p>
          ) : (
          <Points
            items={[
              <>
                {firstName} loses access {events === 1 ? "to that event" : `to those ${events} events`} right away
                {kept.length > 0 ? <>, and stays on as {kept.map((k) => k.label).join(" and ")}</> : null}
              </>,
              ...leaves,
              ...(limited ? [kept.length > 0 ? `${firstName} keeps their team spot` : "A team spot opens up"] : []),
              "We'll email the event's other Volunteer Leads and the Account Host about the change (not you)",
              "You can invite them again from Removed or left recently",
            ]}
          />
          )}
          <NotifyBox label={`Let ${firstName} know by email`} />
          <WindowButtons keep={`Keep ${firstName}`} close={close}>
            <SubmitButton variant="warn" pendingText="Removing…" data-solid disabled={!pick}>
              {!pick ? "Choose what to remove" : events === 1 ? "Remove from this event" : `Remove from ${events} events`}
            </SubmitButton>
          </WindowButtons>
        </ActionForm>
      </Window>
    </>
  );
}

export type AgainEvent = { id: string; label: string };
export type AgainJob = { id: string; name: string; led: boolean };
type StaffRole = "volunteer_director" | "section_lead";
const STAFF_LABEL: Record<StaffRole, string> = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator" };

/**
 * "Invite again": bring someone back in one step. A co-host is asked once and invited to the
 * account. A Volunteer Lead or Coordinator gets a window: a reminder of last time, the event
 * (picked on purpose, never for you), the role, the job for a Coordinator, and the team spot it takes.
 */
export function InviteAgainButton({
  name,
  email,
  lastTime,
  events,
  jobs = {},
  roles = ["volunteer_director", "section_lead"],
  lastRole,
  lastJob,
  spotNote,
  action,
}: {
  name: string;
  email: string;
  /** "Coordinator · Summer Band Camp · led Snack bar" */
  lastTime?: string | null;
  /** Upcoming events with their dates; null for a co-host (they join the whole account). */
  events: AgainEvent[] | null;
  jobs?: Record<string, AgainJob[]>;
  /** The roles this person may be invited to (a Volunteer Lead invites Coordinators only). */
  roles?: StaffRole[];
  lastRole?: StaffRole;
  /** The job they led last time: picked again when the event has one by that name. */
  lastJob?: string | null;
  spotNote: string;
  action: Action;
}) {
  const { ref, key, open, close } = useWindow();
  const [eventId, setEventId] = useState("");
  const [role, setRole] = useState<StaffRole>(lastRole && roles.includes(lastRole) ? lastRole : roles[0]);
  if (!events) {
    return (
      <ConfirmButton
        action={action}
        label={`Invite again: ${name}`}
        title={`Invite ${name} to be a co-host again?`}
        points={[`We'll email ${email} a new invitation`, spotNote]}
        keepLabel="Not now"
        confirmLabel="Send invitation"
        pendingText="Sending…"
        danger={false}
      >
        Invite again
      </ConfirmButton>
    );
  }
  if (!events.length) return <p className="text-sm text-muted">Add an event to invite them again</p>;
  const eventJobs = jobs[eventId] ?? [];
  const sameJob = eventJobs.find((j) => lastJob && j.name.toLowerCase() === lastJob.toLowerCase());
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={ROW_BUTTON}
        aria-label={`Invite again: ${name}`}
        onClick={() => {
          setEventId("");
          setRole(lastRole && roles.includes(lastRole) ? lastRole : roles[0]);
          open();
        }}
      >
        Invite again
      </Button>
      <Window dialogRef={ref} formKey={key} close={close} title={`Invite ${name} again`}>
        <ActionForm action={action} onSuccess={close} className="mt-3 space-y-4">
          {lastTime && <p className="text-sm leading-6 text-muted">Last time: {lastTime}</p>}
          <Field label="Event">
            <Select name="eventId" required value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="" disabled>
                Choose an event
              </option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          {roles.length > 1 ? (
            <Field label="Role">
              <Select name="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {STAFF_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <input type="hidden" name="role" value={roles[0]} />
          )}
          {role === "section_lead" && eventId && (
            <Field label="Job to lead" hint={eventJobs.length ? "Optional. You can also give them a job after they accept." : "This event has no jobs yet. Give them one after they accept."}>
              <Select key={eventId} name="stationId" defaultValue={sameJob?.id ?? ""}>
                <option value="">Choose later</option>
                {eventJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} · {j.led ? "has a Coordinator" : "needs a Coordinator"}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Points items={[`We'll email ${email} an invitation to be a ${STAFF_LABEL[role]}`, spotNote]} />
          <WindowButtons keep="Not now" close={close}>
            <SubmitButton pendingText="Sending…" data-solid>
              Send invitation
            </SubmitButton>
          </WindowButtons>
        </ActionForm>
      </Window>
    </>
  );
}

/**
 * Right after removing someone: what was removed and one Undo, until the time runs out (shown in
 * the viewer's own clock time, then the note goes away). A fresh note takes focus so keyboard and
 * screen-reader users find it (design review 2026-11-07).
 */
export function UndoNote({
  until,
  minutes,
  action,
  name,
  children,
}: {
  until: string;
  /** How long Undo lasts: a note with nearly all of it left was just made. */
  minutes: number;
  action: Action;
  name: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const end = new Date(until).getTime();
    // Clock time only after hydrating (the server's time zone isn't the viewer's).
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    // When time's up: keep keyboard users on the page, and redraw it so rows offer Invite again.
    const done = setTimeout(() => {
      if (ref.current?.contains(document.activeElement)) {
        const heading = document.querySelector<HTMLElement>("main h1");
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      }
      setNow(end);
      router.refresh();
    }, Math.max(0, end - Date.now()));
    // After the window closes and the page updates (which moves focus to the section heading).
    const fresh = end - Date.now() > (minutes * 60 - 30) * 1000;
    const focus = fresh ? setTimeout(() => ref.current?.focus(), 150) : undefined;
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      clearTimeout(done);
      clearTimeout(focus);
    };
  }, [until, minutes, router]);
  if (now !== null && now >= new Date(until).getTime()) return null;
  const time = now === null ? null : new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // The last minute says so (announced once, politely), so a glance back isn't a surprise.
  const lastMinute = now !== null && new Date(until).getTime() - now <= 60_000;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      // Focus moves here after a removal, which reads it out; a live region as well would read it twice.
      role="group"
      aria-label={`Just removed ${name}`}
      className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand-soft px-4 py-3 focus:outline-2 focus:outline-offset-2 focus:outline-[var(--focus)] sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm leading-6">
        {children}
        <p className={lastMinute ? "font-semibold" : "text-muted"} aria-live="polite">
          {lastMinute ? "Undo ends in under a minute." : time ? `You can undo this until ${time}.` : "You can undo this for a few minutes."}
        </p>
      </div>
      <ActionForm action={action} resetOnSuccess={false} className="contents">
        <SubmitButton variant="secondary" pendingText="Undoing…" className={`${ROW_BUTTON} shrink-0`} aria-label={`Undo: put ${name} back`}>
          Undo
        </SubmitButton>
      </ActionForm>
    </div>
  );
}
