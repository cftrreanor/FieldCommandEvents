"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useTabInView } from "@/components/use-tab-in-view";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";

/** The two steps inside each sign-up. */
export type StationStep = "details" | "shifts";

/**
 * Step 2 of Stations & shifts, for the open station: answers typed but not
 * saved in each step, which steps are still to do, and the tab someone tried
 * to move to meanwhile (so each unfinished step can say what's left).
 */
type StationProgress = {
  dirty: Record<StationStep, boolean>;
  setDirty: (step: StationStep, dirty: boolean) => void;
  /** Steps still to do: details never saved, or no shifts yet. */
  needs: Record<StationStep, boolean>;
  leaving: string | null;
  setLeaving: (href: string | null) => void;
};
const Progress = createContext<StationProgress | null>(null);

export function UnsavedChangesProvider({
  needsDetails,
  needsShifts,
  children,
}: {
  needsDetails: boolean;
  needsShifts: boolean;
  children: ReactNode;
}) {
  const [dirty, setDirtyState] = useState<Record<StationStep, boolean>>({ details: false, shifts: false });
  const [leaving, setLeaving] = useState<string | null>(null);
  const setDirty = useCallback((step: StationStep, value: boolean) => {
    setDirtyState((d) => (d[step] === value ? d : { ...d, [step]: value }));
  }, []);
  const value = useMemo(
    () => ({ dirty, setDirty, needs: { details: needsDetails, shifts: needsShifts }, leaving, setLeaving }),
    [dirty, setDirty, needsDetails, needsShifts, leaving],
  );
  return <Progress.Provider value={value}>{children}</Progress.Provider>;
}

/** For a step's form: report whether it has answers that aren't saved. Outside a sign-up's steps, does nothing. */
export function useStepEdits(step: StationStep | undefined) {
  // Only the (stable) setter, not the whole context: the context changes as soon as a step turns dirty, and a
  // new function here would re-run the job form's effects, which cancelled its first scheduled save (a single
  // change, like picking a band check-in stop, then never saved).
  const setDirty = useContext(Progress)?.setDirty;
  return useCallback(
    (value: boolean) => {
      if (step) setDirty?.(step, value);
    },
    [setDirty, step],
  );
}

const NOTES: Record<StationStep, { unsaved: string; todo: string }> = {
  details: {
    unsaved: "Save your changes before you move on.",
    todo: "Save these details to finish this step before you move on.",
  },
  shifts: {
    unsaved: "Add your shift before you move on.",
    todo: "Add at least one shift to finish this before you move on.",
  },
};

/**
 * By a step's button: a light red note when they tried to move to another
 * station with this step unsaved or unfinished, with a way to go anyway.
 */
export function StepNotice({ step }: { step: StationStep }) {
  const progress = useContext(Progress);
  const router = useRouter();
  if (!progress?.leaving) return null;
  const unsaved = progress.dirty[step];
  if (!unsaved && !progress.needs[step]) return null;
  const href = progress.leaving;
  return (
    <div data-step-notice role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm">
      <p className="font-semibold text-danger">{unsaved ? NOTES[step].unsaved : NOTES[step].todo}</p>
      <p className="mt-0.5 text-muted">
        Or{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-2"
          onClick={() => {
            progress.setLeaving(null);
            router.push(href, { scroll: false });
          }}
        >
          {progress.dirty.details || progress.dirty.shifts ? "leave without saving" : "finish it later"}
        </button>
        .
      </p>
    </div>
  );
}

export type StationTab = {
  id: string;
  name: string;
  href: string;
  active: boolean;
  /** Finished: saved with Save sign-up, not just saved for later. */
  saved: boolean;
  /** Finished, with at least one time slot or item. */
  configured: boolean;
  /** Items to bring, not time slots. */
  items?: boolean;
  filled: number;
  capacity: number;
  /** A volunteer event's job (its words: shifts, things to bring). */
  job?: boolean;
  /** A band contest's check-in stop: its place in the order. */
  stop?: number;
  /** A check-in stop with no Coordinator: nobody can check bands in there on contest day. */
  needsLead?: boolean;
};

/** What a tab says under its name: the first thing still to do, or how full it is. */
function status(t: StationTab, unsaved: boolean) {
  if (unsaved) return "Unsaved changes";
  // A volunteer event's job: what it needs, or how full it is.
  if (t.job) {
    const stop = t.stop ? `Stop ${t.stop} · ` : "";
    if (!t.capacity) return stop + (t.items ? "Needs a thing to bring" : "Needs a shift");
    if (t.needsLead) return `${stop}Needs a Coordinator`;
    return `${stop}${t.filled} of ${t.capacity} ${t.items ? "covered" : "filled"}`;
  }
  if (!t.saved) return "Draft, not finished";
  if (!t.capacity) return t.items ? "No items yet" : "No time slots yet";
  return `${t.filled} of ${t.capacity} ${t.items ? "covered" : "filled"}`;
}

/** The stations as tabs: a green check when one is set up, a yellow dot when it isn't yet. */
export function StationTabs({
  tabs,
  add,
  extra = [],
  label = "Sign-ups",
}: {
  /** What the row of tabs is called, for screen readers. */
  label?: string;
  tabs: StationTab[];
  add?: { href: string; active: boolean; label?: string };
  /** Tabs after the sign-ups, set a little apart: Import volunteers, Check-in order. */
  extra?: { key: string; label: string; status: string; href: string; active: boolean }[];
}) {
  const progress = useContext(Progress);
  const row = useTabInView<HTMLElement>([...tabs.map((t) => t.active), add?.active, ...extra.map((t) => t.active)].join());
  // Leaving a sign-up with something unsaved or unfinished: stay, open those steps and point at the first note.
  const guard = (e: React.MouseEvent, href: string, active: boolean) => {
    if (!progress || active) return;
    const holdBack = (["details", "shifts"] as const).filter((s) => progress.dirty[s] || progress.needs[s]);
    if (holdBack.length === 0) return;
    e.preventDefault();
    progress.setLeaving(href);
    for (const step of holdBack) {
      const el = document.getElementById(step === "details" ? "station-details" : "build-shifts") as HTMLDetailsElement | null;
      if (el) el.open = true;
      // Including a tucked-away "Redo or add shifts".
      el?.querySelectorAll("details").forEach((d) => (d.open = true));
    }
    requestAnimationFrame(() => document.querySelector("[data-step-notice]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  return (
    <nav ref={row} aria-label={label} className="relative -mx-4 overflow-x-auto px-4 pt-1 sm:mx-0 sm:px-0">
      {/* Folder-style tabs (the shared tabs pattern): the open one is filled and joined to the page below, the others sit back. */}
      <ul className={folderTabRow}>
        {tabs.map((t) => {
          const unsaved = t.active && Boolean(progress?.dirty.details);
          // Something to do (no shifts yet, unfinished, unsaved): an amber line under the name.
          // A job: what the status line says it needs (a shift or a thing to bring); other sign-ups also count unfinished details.
          const needs = unsaved || (t.job ? !t.capacity || Boolean(t.needsLead) : !t.configured);
          return (
            <li key={t.id}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={t.active ? "page" : undefined}
                onClick={(e) => guard(e, t.href, t.active)}
                className={folderTab(t.active)}
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  {!needs && !t.job && <span aria-hidden>✓</span>}
                  {t.name}
                </span>
                <span className={folderTabNote(needs)}>
                  {needs && <span aria-hidden>◆ </span>}
                  {status(t, unsaved)}
                </span>
              </Link>
            </li>
          );
        })}
        {add && (
          <li>
            <Link href={add.href} scroll={false} aria-current={add.active ? "page" : undefined} className={`${folderTab(add.active)} justify-center`}>
              <span className="whitespace-nowrap font-semibold text-brand">{add.label ?? "+ Add sign-up"}</span>
            </Link>
          </li>
        )}
        {extra.map((t, i) => (
          <li key={t.key} className={i === 0 ? "ml-3" : undefined}>
            <Link
              href={t.href}
              scroll={false}
              aria-current={t.active ? "page" : undefined}
              onClick={(e) => guard(e, t.href, t.active)}
              className={folderTab(t.active)}
            >
              <span className="whitespace-nowrap">{t.label}</span>
              <span className={folderTabNote()}>{t.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
