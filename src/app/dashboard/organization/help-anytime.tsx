"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { setPending, useUnadded } from "@/components/pending-edits";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { addDays, cleanHelpLink, HELP_LAST_DAY_AFTER, HELP_NOTE_MAX, HELP_TITLE_MAX, shortDay, siteOf } from "@/lib/org-page-words";
import { endHelpToday, removeHelpItem, saveHelpItem, type HelpItem } from "../org-page-actions";

// Help anytime (board 3c, with the review's fixes): ongoing ways to help with no shifts, each with an end date so
// it leaves the page by itself. One save model for adding and editing (a Save button, then a Saved line on the
// row); Remove waits a few seconds with Undo before it happens; "End today" keeps it on through today.

const UNDO_MS = 10_000;
const BTN_OUTLINE = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

type RowNote = { kind: "saved"; linkChanged?: boolean } | { kind: "failed"; error: string } | { kind: "removing" };

export function HelpAnytime({ orgId, items: fromPage, today }: { orgId: string; items: HelpItem[]; today: string }) {
  const [items, setItems] = useState(fromPage);
  const [seen, setSeen] = useState(fromPage);
  if (fromPage !== seen) {
    setSeen(fromPage);
    setItems(fromPage);
  }
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [removing, setRemoving] = useState<Record<string, HelpItem>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingKey = useId();
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const note = (id: string, n: RowNote | null) =>
    setNotes((all) => {
      const next = { ...all };
      if (n) next[id] = n;
      else delete next[id];
      return next;
    });

  const dropRemoving = (id: string) =>
    setRemoving((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });

  const reallyRemove = async (item: HelpItem) => {
    clearTimeout(timers.current[item.id]);
    delete timers.current[item.id];
    setPending(`${pendingKey}-${item.id}`, { kind: "saving" });
    try {
      const res = await removeHelpItem(orgId, item.id);
      if (res.error) {
        note(item.id, { kind: "failed", error: `Not removed. ${res.error}` });
        dropRemoving(item.id);
      } else {
        setItems((list) => list.filter((x) => x.id !== item.id));
        dropRemoving(item.id);
        note(item.id, null);
      }
      setPending(`${pendingKey}-${item.id}`, null);
    } catch {
      note(item.id, { kind: "failed", error: "Not removed. Check your connection, then select Remove again." });
      dropRemoving(item.id);
      setPending(`${pendingKey}-${item.id}`, null);
    }
  };

  const startRemove = (item: HelpItem) => {
    setRemoving((r) => ({ ...r, [item.id]: item }));
    note(item.id, { kind: "removing" });
    // Leaving the page before Undo runs out removes it then.
    setPending(`${pendingKey}-${item.id}`, { kind: "saving", flush: () => void reallyRemove(item) });
    timers.current[item.id] = setTimeout(() => void reallyRemove(item), UNDO_MS);
  };

  const undo = (item: HelpItem) => {
    clearTimeout(timers.current[item.id]);
    delete timers.current[item.id];
    setPending(`${pendingKey}-${item.id}`, null);
    dropRemoving(item.id);
    note(item.id, null);
  };

  const active = items.filter((h) => h.ends_on >= today);
  const ended = items.filter((h) => h.ends_on < today).sort((a, b) => b.ends_on.localeCompare(a.ends_on));

  const row = (h: HelpItem) => {
    const n = notes[h.id];
    if (editing === h.id) {
      return (
        <li key={h.id} className="p-3 sm:p-4">
          <HelpForm
            orgId={orgId}
            item={h}
            today={today}
            onDone={(saved, linkChanged) => {
              setEditing(null);
              if (saved) {
                setItems((list) => list.map((x) => (x.id === saved.id ? saved : x)));
                note(saved.id, { kind: "saved", linkChanged });
              }
            }}
          />
        </li>
      );
    }
    if (removing[h.id]) {
      return (
        <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <p role="status" className="[overflow-wrap:anywhere]">
            <span className="font-semibold">{h.title}</span> removed.
          </p>
          <Button type="button" variant="secondary" onClick={() => undo(h)}>
            Undo<span className="sr-only"> removing {h.title}</span>
          </Button>
        </li>
      );
    }
    const isEnded = h.ends_on < today;
    const endsToday = h.ends_on === today;
    return (
      <li key={h.id} className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="font-semibold [overflow-wrap:anywhere]">
            {h.title}{" "}
            <span className="ml-1 align-middle">
              {isEnded ? <Badge tone="neutral">Ended</Badge> : endsToday ? <Badge tone="neutral">Ends today</Badge> : <Badge tone="success">Active</Badge>}
            </span>
          </p>
          {h.note && <p className="text-sm leading-6 [overflow-wrap:anywhere]">{h.note}</p>}
          <p className="text-sm">
            {isEnded ? `Ended ${shortDay(h.ends_on)}. Not on your page` : endsToday ? "On your page through today" : `On your page until ${shortDay(h.ends_on)}`}
          </p>
          {h.link && <p className="text-sm text-muted [overflow-wrap:anywhere]">Link opens {siteOf(h.link)}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN_OUTLINE} onClick={() => setEditing(h.id)}>
            Edit<span className="sr-only"> {h.title}</span>
          </button>
          {!isEnded && !endsToday && (
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={async () => {
                try {
                  const res = await endHelpToday(orgId, h.id);
                  if (res.error || !res.item) note(h.id, { kind: "failed", error: `Not saved. ${res.error ?? ""}`.trim() });
                  else {
                    setItems((list) => list.map((x) => (x.id === h.id ? res.item! : x)));
                    note(h.id, { kind: "saved" });
                  }
                } catch {
                  note(h.id, { kind: "failed", error: "Not saved. Check your connection, then select End today again." });
                }
              }}
            >
              End today<span className="sr-only"> {h.title}</span>
            </button>
          )}
          <Button type="button" variant="quiet-danger" onClick={() => startRemove(h)}>
            Remove<span className="sr-only"> {h.title}</span>
          </Button>
        </div>
        {n && n.kind !== "removing" && (
          <p role="status" className={`text-sm sm:col-span-2 ${n.kind === "failed" ? "font-semibold text-danger" : "font-medium"}`}>
            {n.kind === "failed" ? (
              <>
                <span aria-hidden>▲ </span>
                {n.error}
              </>
            ) : (
              <>
                <span aria-hidden className="text-success">
                  ✓{" "}
                </span>
                Saved{n.linkChanged ? ". We switched the link to https and took off its tracking parts" : ""}
              </>
            )}
          </p>
        )}
      </li>
    );
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold">Help anytime</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Ongoing ways to help with no shifts, like a wish list or a drive. Each one leaves your page after its end date.
      </p>
      {active.length ? (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">{active.map(row)}</ul>
      ) : (
        <p className="mt-4 text-sm leading-6">None yet.</p>
      )}
      {ended.length > 0 && (
        <details className="group mt-3 rounded-md border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 text-sm font-semibold text-brand">
            <span aria-hidden className="inline-block group-open:rotate-90">
              ›
            </span>
            Ended ({ended.length})
          </summary>
          <ul className="divide-y divide-border border-t border-border">{ended.map(row)}</ul>
        </details>
      )}
      {editing === "new" ? (
        <div className="mt-4 rounded-lg border border-border p-3 sm:p-4">
          <HelpForm
            orgId={orgId}
            item={null}
            today={today}
            onDone={(saved, linkChanged) => {
              setEditing(null);
              if (saved) {
                setItems((list) => [...list, saved].sort((a, b) => a.ends_on.localeCompare(b.ends_on)));
                note(saved.id, { kind: "saved", linkChanged });
              } else addButton.current?.focus();
            }}
          />
        </div>
      ) : (
        <button ref={addButton} type="button" className={`${BTN_OUTLINE} mt-4`} onClick={() => setEditing("new")}>
          + Add a way to help
        </button>
      )}
    </Card>
  );
}

type Errors = Partial<Record<"title" | "note" | "link" | "endsOn", string>>;

/** Add or edit one way to help. Nothing changes on the page until Save. */
function HelpForm({
  orgId,
  item,
  today,
  onDone,
}: {
  orgId: string;
  item: HelpItem | null;
  today: string;
  onDone: (saved: HelpItem | null, linkChanged?: boolean) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(item?.title ?? "");
  const [noteText, setNote] = useState(item?.note ?? "");
  const [link, setLink] = useState(item?.link ?? "");
  // A past end date isn't offered: an ended one gets a new day.
  const [endsOn, setEndsOn] = useState(item && item.ends_on >= today ? item.ends_on : "");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const noteUnsaved = useUnadded();
  useEffect(() => heading.current?.focus(), []);
  const last = addDays(today, HELP_LAST_DAY_AFTER);
  const cleaned = cleanHelpLink(link);

  const submit = async () => {
    const e: Errors = {};
    if (!title.trim()) e.title = "Add a title";
    if (cleaned.error) e.link = cleaned.error;
    if (!endsOn) e.endsOn = "Pick an end date";
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) {
      document.getElementById(`${id}-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await saveHelpItem(orgId, { id: item?.id ?? null, title, note: noteText, link, endsOn });
      if (res.fieldErrors) setErrors(res.fieldErrors);
      else if (res.error || !res.item) setError(res.error ?? "Not saved. Try again.");
      else onDone(res.item, res.linkChanged);
    } catch {
      setError("Not saved. Check your connection, then select Save again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onInput={(e) => noteUnsaved(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none [overflow-wrap:anywhere]">
        {item ? `Edit ${item.title}` : "Add a way to help"}
      </h3>
      <Field label="Title" error={errors.title} errorId={`${id}-title-error`}>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={HELP_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${id}-title-error` : undefined}
          className={errors.title ? "!border-danger" : ""}
        />
      </Field>
      <Field label="Note (optional)" hint="One or two lines: what to do and where." error={errors.note}>
        <Textarea id={`${id}-note`} value={noteText} maxLength={HELP_NOTE_MAX} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
      </Field>
      <Field
        label="Link (optional)"
        hint={
          cleaned.url
            ? `Opens ${siteOf(cleaned.url)}, in a new tab.${cleaned.changed && cleaned.url !== `https://${link.trim()}` ? " We'll switch it to https and take off its tracking parts when you save." : ""}`
            : "If there's a page to go to, like a wish list. It shows which site it opens."
        }
        error={errors.link}
        errorId={`${id}-link-error`}
      >
        <Input
          id={`${id}-link`}
          type="url"
          inputMode="url"
          value={link}
          maxLength={600}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => setErrors((x) => ({ ...x, link: cleaned.error }))}
          aria-invalid={errors.link ? true : undefined}
          aria-describedby={errors.link ? `${id}-link-error` : undefined}
          className={errors.link ? "!border-danger" : ""}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-ends-label`} className="text-sm font-semibold">
          End date
        </span>
        <DateField
          id={`${id}-endsOn`}
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          min={today}
          max={last}
          required
          rangeMessage="Pick an end date from today to a year from now."
          aria-label="End date"
          aria-invalid={errors.endsOn ? true : undefined}
          aria-describedby={`${id}-ends-hint${errors.endsOn ? ` ${id}-ends-error` : ""}`}
        />
        <span id={`${id}-ends-hint`} className="text-sm text-muted">
          It leaves your page after this day. Up to a year from today.
        </span>
        {errors.endsOn && (
          <span id={`${id}-ends-error`} className="text-sm font-semibold text-danger">
            {errors.endsOn}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Saving…" : item ? "Save changes" : "Add"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <p className="basis-full text-sm text-muted">{item ? "Nothing changes on your page until you save." : "Nothing is on your page until you select Add."}</p>
        {error && (
          <p role="alert" className="basis-full text-sm font-semibold text-danger">
            <span aria-hidden>▲ </span>
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
