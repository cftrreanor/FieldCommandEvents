"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionForm } from "@/components/action-form";
import { confirmDialog } from "@/components/confirm-dialog";
import { Field, Input, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { AdultsNeededField, BinIcon, CheckInStopFields, CoordinatorPicker, type LeadOption } from "../forms";
import type { CheckpointKind } from "@/lib/contest-day";
import type { JobLinks } from "./job-parts";
import { flushPending, onRetry, pendingCounts, setPending, settled, usePendingCounts } from "@/components/pending-edits";
import { useStepEdits } from "./station-steps";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const FORM = "job-details";
/** How long after the last keystroke a job saves itself. */
const SAVE_AFTER_MS = 900;
const noSubscribe = () => () => {};
const OFFLINE = "Check your connection, then try again.";

type SaveState = "idle" | "waiting" | "saving" | "saved" | "failed";

/**
 * A volunteer event's (or band contest's) job: its name here (right under "Shifts / Things to bring"), then "More options"
 * drawn further down the card, after its shifts or things to bring. Everything saves itself a moment
 * after the last change; the bar pinned to the bottom says so, and holds Delete job and Add another job.
 */
export function JobForm({
  action,
  remove,
  initial,
  coordinators,
  leadLabel,
  links,
  signedUp,
  ready,
  allReady,
  items,
  bands,
  openMore,
}: {
  action: Action;
  remove: () => Promise<ActionState>;
  initial: {
    name: string;
    instructions: string | null;
    adults_only?: boolean;
    min_adults?: number | null;
    lead_ids?: string[];
    checkpoint_kind?: CheckpointKind | null;
    due_minutes_before_warm_up?: number | null;
  };
  coordinators: { options: LeadOption[]; pending: string[]; invite: Action };
  leadLabel: string;
  links: JobLinks;
  /** Someone has signed up for it, so it can't be deleted. */
  signedUp: boolean;
  ready: boolean;
  allReady: boolean;
  items: boolean;
  /** A band contest: the job can be a stop on the bands' contest-day check-in path. */
  bands?: boolean;
  /** Open "More options" from the start (arrived from "Make it a stop"). */
  openMore?: boolean;
}) {
  const [save, setSave] = useState<SaveState>("idle");
  const [stop, setStop] = useState<string>(initial.checkpoint_kind ?? "");
  const [adultsOnly, setAdultsOnly] = useState(initial.adults_only ?? false);
  // Shown on the closed More options, so a saved age rule is never out of sight.
  const ageRule = adultsOnly ? " · adults only" : initial.min_adults ? ` · ${initial.min_adults} adult${initial.min_adults === 1 ? "" : "s"} per shift` : "";
  // Only a job that takes shifts can be a check-in stop (its Coordinators work shifts there).
  const stopHere = bands && !items;
  const [why, setWhy] = useState<string | null>(null);
  const setEdited = useStepEdits("details");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // A lost connection throws instead of answering: say so, like any other failed save.
  const save$ = useCallback<Action>(
    async (prev, formData) => {
      try {
        const r = await action(prev, formData);
        setWhy(r.error ?? null);
        return r;
      } catch {
        setWhy(OFFLINE);
        return { error: OFFLINE };
      }
    },
    [action],
  );

  const submit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const form = document.getElementById(FORM) as HTMLFormElement | null;
    if (!form) return;
    // A blank name can't save: say so instead of saving half of it.
    if (!form.checkValidity()) {
      setWhy("A job needs a name.");
      setSave("failed");
      setPending(FORM, { kind: "failed" });
      return;
    }
    setSave("saving");
    setPending(FORM, { kind: "saving" });
    form.requestSubmit();
  }, []);
  // Sending it again if it never gets an answer.
  useEffect(() => onRetry(FORM, submit), [submit]);

  // A save that never got an answer (see pending-edits): say so, with Try again.
  useEffect(() => {
    const noAnswer = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== FORM) return;
      setWhy("It's taking too long. Check your connection, then try again.");
      setSave("failed");
    };
    window.addEventListener("save-no-answer", noAnswer);
    return () => window.removeEventListener("save-no-answer", noAnswer);
  }, []);

  const changed = useCallback(() => {
    setSave("waiting");
    setEdited(true);
    setPending(FORM, { kind: "saving", flush: submit });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(submit, SAVE_AFTER_MS);
  }, [setEdited, submit]);

  // The form's own answer: saved, or not.
  useEffect(() => {
    const form = document.getElementById(FORM);
    if (!form) return;
    const ok = () => {
      setSave((s) => (s === "waiting" ? s : "saved"));
      setPending(FORM, timer.current ? { kind: "saving", flush: submit } : null);
      setEdited(false);
    };
    const failed = () => {
      setSave("failed");
      setPending(FORM, { kind: "failed" });
    };
    form.addEventListener("form-saved", ok);
    form.addEventListener("form-failed", failed);
    return () => {
      form.removeEventListener("form-saved", ok);
      form.removeEventListener("form-failed", failed);
      if (timer.current) clearTimeout(timer.current);
      setPending(FORM, null);
    };
  }, [setEdited, submit]);

  // Everything not saved on the job's page: this form, its things to bring, and shifts or things typed in but not added.
  const pending = usePendingCounts();
  const unsaved = pending.saving + pending.failed + pending.unadded > 0;

  // Closing the tab first: the browser asks.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Switching apps or tabs (a phone's usual way out) saves straight away instead of waiting.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flushPending);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flushPending);
    };
  }, []);

  // Any link to another page of the app while something isn't saved: save it first, then go.
  // If it can't save, or a shift or thing to bring is typed in but not added, ask.
  const leaving = useRef(false);
  useEffect(() => {
    const guard = (e: MouseEvent) => {
      const counts = pendingCounts();
      if (!counts.saving && !counts.failed && !counts.unadded) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      if (leaving.current) return;
      leaving.current = true;
      void (async () => {
        flushPending();
        const saved = await settled();
        const go =
          (saved && !pendingCounts().unadded) ||
          (await confirmDialog(
            saved
              ? {
                  title: "Leave without adding it?",
                  message: "You typed a shift or a thing to bring that isn't added yet.",
                  confirmLabel: "Leave anyway",
                  cancelLabel: "Stay here",
                }
              : {
                  title: "Leave before it saves?",
                  message: "A change to this job isn't saved.",
                  confirmLabel: "Leave anyway",
                  cancelLabel: "Stay here",
                },
          ));
        leaving.current = false;
        // A job tab keeps the page where it is; another page starts at the top.
        if (go) router.push(href, { scroll: new URL(href, location.href).pathname !== location.pathname });
      })();
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [router]);

  return (
    <ActionForm id={FORM} action={save$} className="space-y-3" resetOnSuccess={false} onEdit={changed}>
      <input type="hidden" name="noun" value="job" />
      <Field label="Job name" hint={bands ? "Like Spectator parking, Concessions, or the Gate" : "Like Parking, Litter pickup, or Supplies to bring"}>
        <Input name="name" required maxLength={80} defaultValue={initial.name} />
      </Field>
      <InSlot id="job-more">
        <details open={openMore} className="group rounded-lg border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              {stopHere ? "More options: band check-in stop, Coordinators, instructions, and age rules" : "More options: Coordinators, instructions, and age rules"}
              {ageRule && <span className="font-normal text-muted">{ageRule}</span>}
            </span>
            <span aria-hidden className="text-brand transition group-open:rotate-90">
              ›
            </span>
          </summary>
          {/* Drawn outside the form: each field names it (form=), and React still passes edits up to it. */}
          <div className="space-y-3 border-t border-border p-3">
            {stopHere && <CheckInStopFields kind={stop} setKind={setStop} initial={initial} formId={FORM} orderHref={links.order} />}
            <CoordinatorPicker label={leadLabel} initial={initial.lead_ids ?? []} onChange={changed} formId={FORM} {...coordinators} />
            <Field label="Instructions for volunteers" hint="Optional. What to wear, bring, and do.">
              <Textarea name="instructions" form={FORM} defaultValue={initial.instructions ?? ""} />
            </Field>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="adultsOnly"
                form={FORM}
                checked={adultsOnly}
                onChange={(e) => setAdultsOnly(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="font-medium">Adults only (18+)</span>
                <span className="block text-muted">No one under 18 can sign up for this job or be added as a walk-up.</span>
              </span>
            </label>
            <AdultsNeededField initial={initial.min_adults} formId={FORM} adultsOnly={adultsOnly} />
          </div>
        </details>
      </InSlot>
      <InSlot id="signup-bar">
        <JobBar save={save} why={why} pending={pending} retry={submit} remove={remove} links={links} signedUp={signedUp} ready={ready} allReady={allReady} items={items} bands={bands} />
      </InSlot>
    </ActionForm>
  );
}

/** Draws its children into a placeholder elsewhere on the job's card (after the shifts, or its pinned bar). */
function InSlot({ id, children }: { id: string; children: ReactNode }) {
  const slot = useSyncExternalStore(
    noSubscribe,
    () => document.getElementById(id),
    () => null,
  );
  return slot ? createPortal(children, slot) : null;
}

const SAVE_WORDS: Record<SaveState, string> = {
  idle: "Saves as you go",
  waiting: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  failed: "Not saved",
};

/**
 * The job's bar, pinned to the bottom of the screen: whether everything on the job is saved, Delete job,
 * Add another job, and the next step. Until the job has a shift or a thing to bring, the next step is
 * greyed out with a note saying why; once every job has one, publishing is the main button.
 */
function JobBar({
  save,
  why,
  pending,
  retry,
  remove,
  links,
  signedUp,
  ready,
  allReady,
  items,
  bands,
}: {
  save: SaveState;
  why: string | null;
  pending: { saving: number; failed: number; unadded: number };
  retry: () => void;
  remove: () => Promise<ActionState>;
  links: JobLinks;
  signedUp: boolean;
  ready: boolean;
  allReady: boolean;
  items: boolean;
  /** A band contest publishes without volunteer jobs, so an empty job never holds back the next step. */
  bands?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A thing to bring that just finished saving says "Saved" too, not just the job's own fields.
  const [itemSaved, setItemSaved] = useState(false);
  const [wasSaving, setWasSaving] = useState(pending.saving);
  if (pending.saving !== wasSaving) {
    setWasSaving(pending.saving);
    setItemSaved(wasSaving > 0 && pending.saving === 0 && pending.failed === 0);
  }
  const button = "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition";
  const filled = `${button} bg-brand text-brand-foreground hover:bg-brand-hover`;
  const outline = `${button} border-[1.5px] border-brand bg-surface text-brand hover:bg-brand-soft`;
  const needs = items ? "a thing to bring" : "a shift";
  // The job's own form first, then the rest of the page's edits.
  const failedHere = save === "failed";
  const itemFailed = !failedHere && pending.failed > 0;
  const saving = !failedHere && !itemFailed && pending.saving > 0;
  const unadded = !failedHere && !itemFailed && !saving ? pending.unadded : 0;
  return (
    <div className="space-y-1.5 rounded-b-lg border-t-2 border-border bg-surface px-4 py-2.5 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm" aria-live="polite" role={failedHere || itemFailed ? "alert" : undefined}>
          {failedHere ? (
            <span className="font-semibold text-danger">
              Not saved. {why ?? "Try again."}{" "}
              <button type="button" onClick={retry} className="underline underline-offset-2">
                Try again
              </button>
            </span>
          ) : itemFailed ? (
            <span className="font-semibold text-danger">
              Not saved. Give each thing to bring a name and a number, and check your connection.{" "}
              <button type="button" onClick={flushPending} className="underline underline-offset-2">
                Try again
              </button>
            </span>
          ) : saving ? (
            <span className="text-muted">Saving…</span>
          ) : unadded ? (
            <span className="font-medium text-warning">
              <span aria-hidden>◆ </span>
              {unadded === 1 ? "1 change isn't added yet." : `${unadded} changes aren't added yet.`} Finish with the button under it, like Create shifts, Add, or Save.
            </span>
          ) : (
            <span className={save === "saved" || (save === "idle" && itemSaved) ? "font-medium" : "text-muted"}>
              {(save === "saved" || (save === "idle" && itemSaved)) && <span aria-hidden className="text-success">✓ </span>}
              {save === "idle" && itemSaved ? "Saved" : SAVE_WORDS[save]}
            </span>
          )}
        </p>
        <div className="flex w-full gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          <button
            type="button"
            disabled={deleting || signedUp}
            aria-describedby={signedUp ? "job-bar-locked" : undefined}
            className={`${button} gap-1.5 border border-danger/40 bg-surface text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:border-field-border disabled:text-disabled`}
            onClick={async () => {
              const ok = await confirmDialog({
                title: "Delete this job?",
                message: "Its shifts and things to bring are deleted too.",
                confirmLabel: "Delete job",
                danger: true,
              });
              if (!ok) return;
              setDeleting(true);
              const r = await remove();
              setDeleting(false);
              setError(r.error ?? null);
            }}
          >
            {!deleting && <BinIcon />}
            {deleting ? "Deleting…" : "Delete job"}
          </button>
          <Link href={links.addJob} scroll={false} className={ready && !allReady ? filled : outline}>
            Add another job
          </Link>
        </div>
      </div>
      {!ready && (
        <p id="job-bar-note" className="text-sm font-medium text-warning">
          <span aria-hidden>◆ </span>
          {bands ? `Add ${needs} to this job. Volunteers can't see it until it has one.` : <>Add {needs} to this job before you publish. Volunteers can&apos;t see it until it has one.</>}
        </p>
      )}
      {signedUp && (
        <p id="job-bar-locked" className="text-sm text-muted">
          People have signed up for this job, so it can&apos;t be deleted.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <a href={links.preview} target="_blank" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
          Preview the sign-up page
        </a>
        {!ready && !bands ? (
          <span
            role="link"
            aria-disabled="true"
            aria-describedby="job-bar-note"
            className="inline-flex min-h-11 cursor-not-allowed items-center rounded-md border-[1.5px] border-field-border px-3 text-sm font-semibold text-disabled"
          >
            {links.next.label} →
          </span>
        ) : allReady && ready ? (
          <Link href={links.next.href} className={filled}>
            {links.next.label} →
          </Link>
        ) : (
          <Link href={links.next.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
            {links.next.label} →
          </Link>
        )}
      </div>
    </div>
  );
}
