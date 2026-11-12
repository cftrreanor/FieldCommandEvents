"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { directorsOf } from "@/lib/rooms";
import type { Conflict } from "./schedule-plan";

// The Rooms and schedule page's windows (boards 4, 11, 12, and 14): one look for all of them, the question as the
// title, an outlined way out that names what you keep, and on phones full-width buttons with the safe one nearest
// the thumb (L13).

/** A window that shows while `open`. Escape, a click outside, and the way-out button all call `onClose`. */
export function Window({
  open,
  title,
  onClose,
  children,
  actions,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      heading.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`team-window m-auto w-[calc(100%-2rem)] ${wide ? "max-w-xl" : "max-w-lg"} rounded-xl border border-border p-0 text-left text-foreground shadow-elevated`}
    >
      {open && (
        <div className="p-5 sm:p-6">
          <h2 id={id} ref={heading} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none [overflow-wrap:anywhere]">
            {title}
          </h2>
          <div className="mt-2 space-y-3 text-sm leading-6">{children}</div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

/** A radio button drawn the same in both themes (globals.css, .team-radio). */
export function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${checked ? "border-brand bg-brand-soft/40" : "border-field-border"}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="team-radio mt-1" />
      <span>{children}</span>
    </label>
  );
}

/** "Email the directors?": email those whose times change (the default), or nobody. */
export function EmailChoice({ count, email, setEmail, emailLabel }: { count: number; email: boolean; setEmail: (on: boolean) => void; emailLabel?: string }) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold">Email the directors?</legend>
      <Choice name={name} checked={email} onChange={() => setEmail(true)}>
        {emailLabel ?? `Email the directors of ${count === 1 ? "the group" : `the ${count} groups`} whose times change`}
      </Choice>
      <Choice name={name} checked={!email} onChange={() => setEmail(false)}>
        Don&apos;t email anyone (the festival page updates either way)
      </Choice>
    </fieldset>
  );
}

const SHOW = 5;

/** Every group whose times change, old and new; past five, "Show N more" opens the rest. */
export function ChangeList({ changes }: { changes: { name: string; text: string }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? changes : changes.slice(0, SHOW);
  return (
    <>
      <ul className="space-y-1">
        {shown.map((c) => (
          <li key={c.name}>
            <span className="font-semibold">{c.name}:</span> {c.text}
          </li>
        ))}
      </ul>
      {changes.length > SHOW && !all && (
        <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
          Show {changes.length - SHOW} more
        </button>
      )}
    </>
  );
}

/**
 * "Save the new times?" (board 12): what the change does, every group whose times move with old and new, and the
 * email choice. The button names the count. With nobody affected, a plain "Save".
 */
export function SaveTimesWindow({
  open,
  title = "Save the new times?",
  intro,
  changes,
  busy,
  error,
  onSave,
  onClose,
  keepLabel = "Keep editing",
  saveLabel,
  danger = false,
}: {
  open: boolean;
  title?: string;
  intro?: ReactNode;
  changes: { name: string; text: string }[];
  busy: boolean;
  error: string | null;
  onSave: (email: boolean) => void;
  onClose: () => void;
  keepLabel?: string;
  /** The button's words when nobody's times change ("Save"). */
  saveLabel?: string;
  danger?: boolean;
}) {
  const [email, setEmail] = useState(true);
  const n = changes.length;
  const label = n === 0 ? (saveLabel ?? "Save") : email ? `Save and email ${directorsOf(n)}` : "Save without emailing";
  return (
    <Window
      open={open}
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {keepLabel}
          </Button>
          <Button type="button" variant={danger ? "warn" : "primary"} onClick={() => onSave(n > 0 && email)} disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : danger && n > 0 ? label.replace(/^Save/, "Remove") : label}
          </Button>
        </>
      }
    >
      {intro}
      {n > 0 ? (
        <>
          <p>Times change for {n === 1 ? "1 group" : `${n} groups`}:</p>
          <ChangeList changes={changes} />
          <EmailChoice count={n} email={email} setEmail={setEmail} />
        </>
      ) : (
        <p>Nobody&apos;s times change, so nobody is emailed.</p>
      )}
      {error && (
        <p role="alert" className="font-semibold text-danger">
          <span aria-hidden>▲ </span>Not saved. {error}
        </p>
      )}
    </Window>
  );
}

/**
 * A co-host saved first (FC409): who, when, and what they did; the change not saved yet; and the two ways on.
 * Taking theirs and adding yours loads their version and puts the same steps on top.
 */
export function ConflictWindow({
  conflict,
  mine,
  onAddMine,
  onDropMine,
}: {
  conflict: Conflict | null;
  mine: string;
  onAddMine: () => void;
  onDropMine: () => void;
}) {
  const latest = conflict?.changes[0];
  const title = latest ? `${latest.name} changed the schedule${latest.at ? ` at ${latest.at}` : ""}` : "Someone changed the schedule";
  return (
    <Window
      open={Boolean(conflict)}
      title={title}
      // No quiet way out: dropping the change is a choice they make with its button.
      onClose={() => {}}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onDropMine}>
            Use their version, drop my change
          </Button>
          <Button type="button" onClick={onAddMine}>
            Use their version and add my change
          </Button>
        </>
      }
    >
      {conflict?.changes.map((c, i) => (
        <p key={i}>
          {i > 0 && <span className="font-semibold">{c.name}{c.at ? ` at ${c.at}` : ""}: </span>}
          {c.summary ? `${c.summary.replace(/\.$/, "")}.` : "They saved a change."}
        </p>
      ))}
      <p>
        <span className="font-semibold">Your change, not saved yet:</span> {mine ? `${mine.replace(/\.$/, "")}.` : "nothing yet."} Nobody was emailed about it.
      </p>
    </Window>
  );
}
