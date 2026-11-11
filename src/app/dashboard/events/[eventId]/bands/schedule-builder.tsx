"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PublishBar, PublishLine } from "@/components/publish-bar";
import type { ChangedBands, ScheduleSaveState } from "@/app/dashboard/band-actions";
import { NumberInput } from "@/components/number-input";
import { Button, Field, FormMessage, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { displayTime, formatDuration, performTimes, toMinutes, toTime } from "@/lib/schedule";
import { formatDate } from "@/lib/time";
import {
  Accordion,
  BreakDividers,
  BreakForm,
  breakSpans,
  DURATIONS,
  TimesEditor,
  type BreakDraft,
  type FinalsSlot,
  type OrderBand,
  type ScheduleBreak,
  type Times,
} from "./schedule-parts";
import { RoundRows, RowEditor, type Row } from "./schedule-view";
import { confirmDialog, confirmFromText, shareDialog } from "@/components/confirm-dialog";
import { folderTab, folderTabNote, folderTabRow } from "@/components/folder-tabs";
import { LineIcon } from "@/components/line-icon";
import { TimeField } from "@/components/time-field";

export type { FinalsSlot, OrderBand, ScheduleBreak };

const MAX_FINALISTS = 30;

let nextKey = 0;
const toDraft = (b: ScheduleBreak): BreakDraft => ({ ...b, minutes: String(b.minutes), key: nextKey++ });
const pickTimes = ({ day, warmUp, warmUpMinutes, perform, location }: Times): Times => ({ day, warmUp, warmUpMinutes, perform, location });
const blankTimes = (day: string): Times => ({ day, warmUp: "", warmUpMinutes: 0, perform: "", location: "" });
const breakRange = (b: BreakDraft) =>
  b.start && Number(b.minutes) > 0 ? `${displayTime(b.start)} – ${displayTime(toTime(toMinutes(b.start) + Number(b.minutes)))}` : "Time not set";

type Snapshot = { bands: OrderBand[]; breaks: BreakDraft[]; finals: FinalsSlot[]; readyText: string; finalsReadyText: string };
type Round = "order" | "finals";

/** What the host is editing. One thing at a time, so the footer has one clear Save. */
type Editing =
  | null
  | { kind: "prelims" }
  | { kind: "finals" }
  | { kind: "row"; round: Round; index: number; draft: Times; bandId: string; shiftLater: boolean }
  | { kind: "break"; key: number; isNew: boolean; from: "list" | Round; draft: BreakDraft; remove: boolean; shiftLater: boolean };

/**
 * The host's performance schedule: breaks for the whole day, the preliminaries
 * and an optional finals round. Each part is viewed read-only and edited on
 * its own. Save and Cancel sit with the boxes being edited; publishing lives in
 * the outlined bar at the top.
 */
export function ScheduleBuilder({
  initialBands,
  initialBreaks,
  initialFinals,
  initialReadyMinutes,
  initialFinalsReadyMinutes,
  days,
  zoneLabel,
  orderPublished,
  finalsPublished,
  finalistsRevealed,
  save,
  emailChanges,
  publishOrder,
  publishFinals,
  revealFinalists,
  emailFinalists,
}: {
  initialBands: OrderBand[];
  initialBreaks: ScheduleBreak[];
  initialFinals: FinalsSlot[];
  initialReadyMinutes: number;
  initialFinalsReadyMinutes: number;
  days: string[];
  zoneLabel: string;
  orderPublished: boolean;
  finalsPublished: boolean;
  /** Stage 3 of the finals: names are on the public schedule and director pages. */
  finalistsRevealed: boolean;
  save: (scheduleJson: string) => Promise<ScheduleSaveState>;
  emailChanges: (bands: ChangedBands) => Promise<ActionState>;
  publishOrder: (publish: boolean) => Promise<ActionState>;
  publishFinals: (publish: boolean) => Promise<ActionState>;
  revealFinalists: (reveal: boolean) => Promise<ActionState>;
  emailFinalists: () => Promise<ActionState>;
}) {
  // The last saved schedule, and working copies of the part being edited.
  const [saved, setSaved] = useState<Snapshot>(() => ({
    bands: initialBands,
    breaks: initialBreaks.map(toDraft),
    finals: initialFinals,
    readyText: String(initialReadyMinutes),
    finalsReadyText: String(initialFinalsReadyMinutes),
  }));
  const [bands, setBands] = useState(initialBands);
  const [finals, setFinals] = useState(initialFinals);
  // Typed number boxes keep their text so they can be cleared while typing.
  const [readyText, setReadyText] = useState(String(initialReadyMinutes));
  const [finalsReadyText, setFinalsReadyText] = useState(String(initialFinalsReadyMinutes));
  // A brand-new schedule (no times yet) opens straight into the preliminaries builder.
  const [editing, setEditing] = useState<Editing>(
    orderPublished || initialBands.length === 0 || initialBands.some((b) => b.perform) ? null : { kind: "prelims" },
  );
  // While a round is being edited, breaks are edited right alongside it (a
  // working copy saved with the round); otherwise each break saves on its own.
  const [breaksWork, setBreaksWork] = useState(saved.breaks);
  const [inlineBreak, setInlineBreak] = useState<{ key: number; from: "list" | Round } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ActionState>({});
  // Something went public (the schedule, finals, finalist names): show the link to share.
  useEffect(() => {
    if (result.ok && result.share) shareDialog(result.share);
  }, [result]);
  const [pending, startTransition] = useTransition();
  // Published bands whose times changed since the host last emailed them.
  const [changes, setChanges] = useState<ChangedBands | null>(null);
  // Moving a band carries its times with it. The slot times from before the
  // first move are kept so "Update schedule" can give each position its time
  // and warm-up location back, in the new order. null = nothing to update.
  const [before, setBefore] = useState<{ ids: string[]; slots: Times[] } | null>(null);

  // The tabs: Preliminaries and Finals (optional), each with the day's breaks. The page
  // opens on what's still to do: the finals once the preliminaries are out.
  const [tab, setTab] = useState<Tab>(() =>
    orderPublished && initialFinals.length > 0 && !finalistsRevealed ? "finals" : "prelims",
  );
  // A tab picked while something was half-edited: the window asking to save first, then where to go.
  const [leaving, setLeaving] = useState<{ to: Tab; saving: boolean } | null>(null);
  const roundEditing = editing?.kind === "prelims" || editing?.kind === "finals";
  const breaks = roundEditing ? breaksWork : saved.breaks;
  const breaksEditable = editing === null || roundEditing;
  const readyMinutes = Number(editing?.kind === "prelims" ? readyText : saved.readyText) || 0;
  const finalsReadyMinutes = Number(editing?.kind === "finals" ? finalsReadyText : saved.finalsReadyText) || 0;
  const busy = editing !== null;

  const touched = () => {
    setDirty(true);
    setResult({});
  };
  const start = (next: Editing) => {
    setResult({});
    setDirty(false);
    setInlineBreak(null);
    setBreaksWork(saved.breaks);
    setEditing(next);
  };
  const cancel = async () => {
    if (dirty && !(await confirmDialog({ title: "Discard the changes you haven't saved?", confirmLabel: "Discard changes", cancelLabel: "Keep editing", danger: true }))) return;
    discard();
  };
  const discard = () => {
    setBands(saved.bands);
    setFinals(saved.finals);
    setReadyText(saved.readyText);
    setFinalsReadyText(saved.finalsReadyText);
    setBreaksWork(saved.breaks);
    setInlineBreak(null);
    setBefore(null);
    setDirty(false);
    setResult({});
    setEditing(null);
  };

  const toJson = (x: Snapshot) =>
    JSON.stringify({
      readyMinutes: x.readyText,
      finalsReadyMinutes: x.finalsReadyText,
      slots: x.bands.map((b) => ({
        band_id: b.id,
        day: b.day,
        warmUp: b.warmUp,
        warmUpMinutes: b.warmUpMinutes,
        perform: b.perform,
        location: b.location,
      })),
      breaks: x.breaks.map(({ day, start, minutes, label }) => ({ day, start, minutes, label })),
      finals: x.finals.map((f) => ({
        band_id: f.bandId,
        day: f.day,
        warmUp: f.warmUp,
        warmUpMinutes: f.warmUpMinutes,
        perform: f.perform,
        location: f.location,
      })),
    });

  /** Save the whole schedule (atomic), then go back to viewing (or on to the tab the host picked). */
  const persist = (x: Snapshot, then?: () => Promise<ActionState>) =>
    startTransition(async () => {
      const { changed, ...r } = await save(toJson(x));
      // Saving on the way to another tab: go there once it's saved, or stay to show what went wrong.
      const to = leaving?.to;
      setLeaving(null);
      setResult(r.ok && then ? await then() : r);
      if (changed) {
        // Keep collecting across saves until the host sends or dismisses.
        setChanges((c) => ({
          order: [...new Set([...(c?.order ?? []), ...changed.order])],
          finals: [...new Set([...(c?.finals ?? []), ...changed.finals])],
        }));
      }
      if (!r.ok) return;
      if (to) setTab(to);
      setSaved(x);
      setBands(x.bands);
      setFinals(x.finals);
      setReadyText(x.readyText);
      setFinalsReadyText(x.finalsReadyText);
      setBreaksWork(x.breaks);
      setInlineBreak(null);
      setBefore(null);
      setDirty(false);
      setEditing(null);
    });

  /** Another tab: straight there, unless something here is changed and not saved. */
  const pickTab = (to: Tab) => {
    if (to === tab) return;
    if (editing && dirty) return setLeaving({ to, saving: false });
    if (editing) discard();
    setTab(to);
  };

  const onSave = (then?: () => Promise<ActionState>) => {
    if (!editing) return;
    if (editing.kind === "prelims") return persist({ ...saved, bands, readyText, breaks: breaksWork });
    if (editing.kind === "finals") return persist({ ...saved, finals, finalsReadyText, breaks: breaksWork }, then);
    if (editing.kind === "break") {
      const { key, isNew, draft, remove, shiftLater } = editing;
      const nextBreaks = remove ? saved.breaks.filter((b) => b.key !== key) : isNew ? [...saved.breaks, draft] : saved.breaks.map((b) => (b.key === key ? draft : b));
      const { delta, day, pivot } = breakShift(editing, saved.breaks);
      const shiftRows = <T extends Times>(rows: T[]): T[] =>
        shiftLater && delta
          ? rows.map((r) =>
              r.day === day && r.perform && toMinutes(r.perform) >= pivot
                ? { ...r, perform: toTime(toMinutes(r.perform) + delta), warmUp: r.warmUp ? toTime(toMinutes(r.warmUp) + delta) : r.warmUp }
                : r,
            )
          : rows;
      return persist({ ...saved, breaks: nextBreaks, bands: shiftRows(saved.bands), finals: shiftRows(saved.finals) });
    }
    // One row changed from the view, optionally moving the timed rows after it
    // on the same day by the same amount.
    const { round, index, draft, bandId, shiftLater } = editing;
    const list: Times[] = round === "order" ? saved.bands : saved.finals;
    const old = list[index];
    const delta = shiftLater && old.perform && draft.perform ? toMinutes(draft.perform) - toMinutes(old.perform) : 0;
    const shift = (t: string) => (t ? toTime(toMinutes(t) + delta) : t);
    const apply = <T extends Times>(rows: T[]): T[] =>
      rows.map((r, k) =>
        k === index
          ? { ...r, ...draft }
          : delta && k > index && r.day === old.day && r.perform
            ? { ...r, perform: shift(r.perform), warmUp: shift(r.warmUp) }
            : r,
      );
    return round === "order"
      ? persist({ ...saved, bands: apply(saved.bands) })
      : persist({ ...saved, finals: apply(saved.finals).map((f, k) => (k === index ? { ...f, bandId } : f)) }, then);
  };

  const run = async (action: () => Promise<ActionState>, confirmMessage?: string) => {
    if (confirmMessage && !(await confirmDialog(confirmFromText(confirmMessage)))) return;
    startTransition(async () => setResult(await action()));
  };

  // --- Editing helpers ------------------------------------------------------
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= bands.length) return;
    const next = [...bands];
    [next[i], next[j]] = [next[j], next[i]];
    const base = before ?? { ids: bands.map((b) => b.id), slots: bands.map(pickTimes) };
    // Moved back to where it started: nothing left to update.
    setBefore(next.every((b, k) => b.id === base.ids[k]) ? null : base);
    setBands(next);
    touched();
  };
  const updateSchedule = () => {
    if (!before) return;
    setBands(bands.map((b, i) => ({ ...b, ...before.slots[i] })));
    setBefore(null);
    touched();
  };
  const updateButton = (
    <Button type="button" variant={before ? "primary" : "secondary"} disabled={!before} onClick={updateSchedule}>
      Update schedule
    </Button>
  );
  const editRow = (round: Round, index: number) => {
    const row = round === "order" ? saved.bands[index] : saved.finals[index];
    start({ kind: "row", round, index, draft: pickTimes(row), bandId: round === "finals" ? saved.finals[index].bandId : "", shiftLater: false });
  };
  const openBreak = (key: number, from: "list" | Round) => {
    if (roundEditing) {
      setInlineBreak(inlineBreak?.key === key && inlineBreak.from === from ? null : { key, from });
      return;
    }
    const b = saved.breaks.find((x) => x.key === key);
    if (b) start({ kind: "break", key, isNew: false, from, draft: { ...b }, remove: false, shiftLater: false });
  };
  const addBreak = () => {
    const key = nextKey++;
    const draft = { key, day: breaks.at(-1)?.day ?? days[0], start: "12:00", minutes: "30", label: breaks.length ? "Break" : "Lunch" };
    if (roundEditing) {
      setBreaksWork([...breaksWork, draft]);
      setInlineBreak({ key, from: "list" });
      touched();
      return;
    }
    start({ kind: "break", key, isNew: true, from: "list", draft, remove: false, shiftLater: false });
    setDirty(true);
  };
  const inlineDraft = roundEditing && inlineBreak ? breaksWork.find((b) => b.key === inlineBreak.key) : undefined;
  const breakOpenKey = (from: "list" | Round) =>
    editing?.kind === "break" && editing.from === from ? editing.key : inlineBreak?.from === from ? inlineBreak.key : null;

  const finalsEditing = editing?.kind === "finals" || (editing?.kind === "row" && editing.round === "finals");
  // Names picked in the editor, after saving.
  const pickedAfterSave =
    editing?.kind === "finals"
      ? finals.filter((f) => f.bandId).length
      : editing?.kind === "row" && editing.round === "finals"
        ? saved.finals.filter((f, k) => (k === editing.index ? editing.bandId : f.bandId)).length
        : 0;
  // Once finalists are revealed, saving a newly picked name shows it straight away.
  const revealing = !finalistsRevealed
    ? 0
    : editing?.kind === "finals"
      ? finals.filter((f, i) => f.bandId && f.bandId !== saved.finals[i]?.bandId).length
      : editing?.kind === "row" && editing.round === "finals" && editing.bandId && editing.bandId !== saved.finals[editing.index]?.bandId
        ? 1
        : 0;
  // Save and Cancel sit with the boxes being edited: under the round's list, or
  // inside a break or row editor.
  const editActions = () =>
    editing && (
      <div className="mt-2 space-y-2 border-t border-border pt-3">
        <FormMessage error={result.error} />
        <p className="text-sm">
          <span className="font-semibold">{editingLabel(editing, saved)}</span>
          {liveNote(editing, orderPublished, finalsPublished) && <span className="text-muted"> · goes live as soon as you save</span>}
        </p>
        {revealing > 0 && (
          <p className="text-sm font-medium text-danger">
            <LineIcon name="warning" inline />Finalists are revealed: saving makes {revealing} more name{revealing === 1 ? "" : "s"} public right away.
            Directors aren&apos;t emailed until you tap Email finalists.
          </p>
        )}
        {editing.kind === "prelims" && before && (
          <p className="text-sm text-muted">You moved bands; their times moved with them. Update the schedule to re-time the new order.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" className="min-h-10 px-3" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
          {editing.kind === "prelims" && updateButton}
          {finalsEditing && finalsPublished && !finalistsRevealed ? (
            <>
              <Button type="button" variant="secondary" className="ml-auto min-h-10" onClick={() => onSave()} disabled={pending || !dirty}>
                {pending ? "Saving…" : "Save only"}
              </Button>
              <Button
                type="button"
                variant="warn"
                className="min-h-10"
                disabled={pending || pickedAfterSave === 0}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: `Save and reveal ${pickedAfterSave} finalist${pickedAfterSave === 1 ? "" : "s"}?`,
                    message: "Their names will show on the public schedule and their directors will see it right away.",
                    confirmLabel: "Save & reveal",
                    danger: true,
                  });
                  if (!ok) return;
                  onSave(() => revealFinalists(true));
                }}
              >
                Save & reveal
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant={revealing ? "warn" : "primary"}
              className="ml-auto min-h-10"
              onClick={async () => {
                if (
                  revealing &&
                  !(await confirmDialog({
                    title: `Show ${revealing} more finalist name${revealing === 1 ? "" : "s"}?`,
                    message: "Finalists are revealed, so saving shows them on the public schedule right away, and directors can see it.",
                    confirmLabel: "Save",
                    danger: true,
                  }))
                )
                  return;
                onSave();
              }}
              disabled={pending || (!dirty && !(editing.kind === "break" && editing.isNew))}
            >
              {pending ? "Saving…" : revealing ? "Save & show names" : saveLabel(editing)}
            </Button>
          )}
        </div>
      </div>
    );

  const breakShiftInfo = editing?.kind === "break" ? breakShift(editing, saved.breaks) : null;
  const after = (rows: Times[]) =>
    breakShiftInfo && breakShiftInfo.delta
      ? rows.filter((r) => r.day === breakShiftInfo.day && r.perform && toMinutes(r.perform) >= breakShiftInfo.pivot).length
      : 0;
  const shiftPrelims = after(saved.bands);
  const shiftFinals = after(saved.finals);
  const shiftCount = shiftPrelims + shiftFinals;
  const breakEditor =
    editing?.kind === "break" ? (
      <div className="mt-2 space-y-3 rounded-xl border border-brand bg-surface p-4 text-foreground">
        <BreakForm
          value={editing.draft}
          days={days}
          zoneLabel={zoneLabel}
          onChange={(p) => {
            setEditing({ ...editing, draft: { ...editing.draft, ...p } });
            touched();
          }}
        />
        {!editing.isNew && (
          <label className="flex items-center gap-2 text-sm text-danger">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={editing.remove}
              onChange={(e) => {
                setEditing({ ...editing, remove: e.target.checked });
                touched();
              }}
            />
            Remove this break
          </label>
        )}
        {shiftCount > 0 && breakShiftInfo && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-3 text-sm">
            <p className="font-medium">
              <LineIcon name="warning" inline />{shiftCount} {shiftCount === 1 ? "performance is" : "performances are"} scheduled from{" "}
              {displayTime(toTime(breakShiftInfo.pivot))} on. They won&apos;t move unless you say so.
            </p>
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={editing.shiftLater}
                onChange={(e) => setEditing({ ...editing, shiftLater: e.target.checked })}
              />
              <span>
                Also move {shiftCount === 1 ? "it" : `all ${shiftCount}`} {Math.abs(breakShiftInfo.delta)} min{" "}
                {breakShiftInfo.delta > 0 ? "later" : "earlier"} (
                {[shiftPrelims && `${shiftPrelims} in the preliminaries`, shiftFinals && `${shiftFinals} in the finals`].filter(Boolean).join(", ")})
              </span>
            </label>
          </div>
        )}
        {editActions()}
      </div>
    ) : inlineDraft ? (
      <div className="mt-2 space-y-3 rounded-xl border border-brand bg-surface p-4 text-foreground">
        <BreakForm
          value={inlineDraft}
          days={days}
          zoneLabel={zoneLabel}
          onChange={(p) => {
            setBreaksWork(breaksWork.map((b) => (b.key === inlineDraft.key ? { ...b, ...p } : b)));
            touched();
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="danger"
            className="min-h-9 px-3"
            onClick={() => {
              setBreaksWork(breaksWork.filter((b) => b.key !== inlineDraft.key));
              setInlineBreak(null);
              touched();
            }}
          >
            Remove break
          </Button>
          <Button type="button" variant="ghost" className="min-h-9 px-3" onClick={() => setInlineBreak(null)}>
            Close
          </Button>
          <span className="text-sm text-muted">Saved with the {editing?.kind === "finals" ? "finals" : "preliminaries"}.</span>
        </div>
      </div>
    ) : null;

  const rowEditorFor = (round: Round, rows: Times[]) => {
    if (editing?.kind !== "row" || editing.round !== round) return null;
    const old = rows[editing.index];
    return (
      <>
      <RowEditor
        draft={editing.draft}
        original={old}
        bandId={round === "finals" ? editing.bandId : undefined}
        bandOptions={round === "finals" ? saved.bands : undefined}
        takenBandIds={saved.finals.map((f) => f.bandId).filter(Boolean)}
        later={rows.slice(editing.index + 1).filter((r) => r.day === old.day && r.perform).length}
        shiftLater={editing.shiftLater}
        readyMinutes={round === "finals" ? finalsReadyMinutes : readyMinutes}
        breaks={breaks}
        days={days}
        onChange={(p) => {
          setEditing({ ...editing, draft: { ...editing.draft, ...p } });
          touched();
        }}
        onBandChange={(bandId) => {
          setEditing({ ...editing, bandId });
          touched();
        }}
        onShiftLater={(shiftLater) => setEditing({ ...editing, shiftLater })}
        note={round === "finals" ? <FinalistPrivacyNote published={finalsPublished} revealed={finalistsRevealed} /> : undefined}
      />
      {editActions()}
      </>
    );
  };

  if (initialBands.length === 0) return <p className="text-muted">No bands have registered yet.</p>;

  const orderRows: Row[] = saved.bands.map((b, i) => ({
    key: b.id,
    number: String(i + 1),
    title: b.name,
    subtitle: `${b.school} · ${b.classification}`,
    conflicts: b.conflicts,
    times: b,
  }));
  const finalsRows: Row[] = saved.finals.map((f, i) => {
    const band = saved.bands.find((b) => b.id === f.bandId);
    return {
      key: `f${i}`,
      number: `F${i + 1}`,
      title: band?.name ?? `Finalist ${i + 1}`,
      subtitle: band ? band.school : "To be announced",
      conflicts: null,
      times: f,
    };
  });
  const picked = saved.finals.filter((f) => f.bandId).length;
  const editButton = (label: string, onClick: () => void) => (
    <Button type="button" variant="secondary" className="ml-auto min-h-9 px-3" disabled={busy} onClick={onClick}>
      {label}
    </Button>
  );
  const timed = saved.bands.filter((b) => b.perform).length;
  // The day's breaks, in both tabs: they apply to the preliminaries and the finals.
  const breaksList = (
    <BreaksList
      breaks={breaks}
      canEdit={breaksEditable}
      openKey={breakOpenKey("list")}
      adding={editing?.kind === "break" && editing.isNew ? editing.draft : null}
      breakEditor={breakEditor}
      onOpen={(key) => openBreak(key, "list")}
      onAdd={addBreak}
    />
  );

  return (
    // The publish bar: pinned under the title on a computer, to the bottom on a
    // phone. Save and Cancel sit with whatever is being edited.
    <div className="flex flex-col gap-3">
      <div>
        <ScheduleTabs
          tabs={[
            {
              key: "prelims",
              label: "Preliminaries",
              status: orderPublished ? "Published" : timed === saved.bands.length ? "Ready to publish" : "Needs to be done",
              mark: orderPublished ? "done" : "todo",
            },
            {
              key: "finals",
              label: "Finals",
              status:
                saved.finals.length === 0 ? "Optional" : finalistsRevealed ? "Finalists revealed" : finalsPublished ? "Published" : "Not published",
              mark: saved.finals.length === 0 ? undefined : finalsPublished ? "done" : "todo",
            },
          ]}
          current={tab}
          onPick={pickTab}
        />
        <div className="mt-6">
          {tab === "prelims" && (
            <TabPanel
              title="Preliminaries"
              intro="Put the bands in order and give each a time. Publish from the outlined bar: each director is emailed their times."
              breaks={breaksList}
            >
        <div className="space-y-4">
                {editing?.kind !== "prelims" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted">
                      {timed} of {saved.bands.length} bands have a time
                    </span>
                    {editButton("Edit preliminaries", () => start({ kind: "prelims" }))}
                  </div>
                )}
                {editing?.kind === "prelims" ? (
                  <>
                    <AutoFill
                      title="Fill in times automatically"
                      noun={bands.length === 1 ? "band" : "bands"}
                      count={bands.length}
                      days={days}
                      defaultDay={days[0]}
                      defaultFirst="09:00"
                      zoneLabel={zoneLabel}
                      breaks={breaks}
                      readyText={readyText}
                      readyHint="Same for every band in the preliminaries, 0 to 60."
                      onReadyText={(v) => {
                        setReadyText(v);
                        touched();
                      }}
                      onFill={(times) => {
                        setBands(bands.map((b, i) => ({ ...b, ...times[i] })));
                        setBefore(null);
                        touched();
                      }}
                      extraAction={updateButton}
                    />
                    <ol className="space-y-3">
                      {bands.map((b, i) => (
                        <BreakDividers
                          key={b.id}
                          breaks={breaks}
                          prev={bands[i - 1]}
                          cur={b}
                          onOpenBreak={(key) => openBreak(key, "order")}
                          openBreakKey={breakOpenKey("order")}
                          breakEditor={breakEditor}
                        >
                          <li className="rounded-xl border border-border bg-surface p-4">
                            <div className="flex items-start gap-3">
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-semibold text-brand-foreground">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold">{b.name}</p>
                                <p className="text-sm text-muted">
                                  {b.school} · {b.classification}
                                </p>
                                {b.conflicts && <p className="mt-1 text-sm"><LineIcon name="warning" inline />{b.conflicts}</p>}
                              </div>
                              <div className="flex shrink-0 flex-col gap-1">
                                <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${b.name} earlier`}>
                                  ↑
                                </Button>
                                <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={() => move(i, 1)} disabled={i === bands.length - 1} aria-label={`Move ${b.name} later`}>
                                  ↓
                                </Button>
                              </div>
                            </div>
                            <TimesEditor
                              value={b}
                              days={days}
                              breaks={breaks}
                              readyMinutes={readyMinutes}
                              onChange={(patch) => {
                                setBands(bands.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                                touched();
                              }}
                            />
                          </li>
                        </BreakDividers>
                      ))}
                    </ol>
                    {editActions()}
                  </>
                ) : (
                  <RoundRows
                    rows={orderRows}
                    breaks={breaks}
                    readyMinutes={readyMinutes}
                    days={days}
                    editIndex={editing?.kind === "row" && editing.round === "order" ? editing.index : null}
                    rowEditor={rowEditorFor("order", saved.bands)}
                    canEdit={!busy}
                    onEditRow={(i) => editRow("order", i)}
                    onOpenBreak={(key) => openBreak(key, "order")}
                    openBreakKey={breakOpenKey("order")}
                    breakEditor={breakEditor}
                  />
                )}
              </div>
            </TabPanel>
          )}
          {tab === "finals" && (
            <TabPanel
              title="Finals"
              intro="If the contest has a finals round, set up its time slots now and pick the finalists once results are in."
              breaks={breaksList}
            >
        <div className="space-y-4">
                {saved.finals.length > 0 && editing?.kind !== "finals" && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted">
                      {picked} of {saved.finals.length} finalists picked
                      {finalsPublished && !finalistsRevealed ? " · names not revealed yet" : ""}
                    </span>
                    {editButton("Edit finals", () => start({ kind: "finals" }))}
                  </div>
                )}
                {editing?.kind === "finals" ? (
                  <>
                  <FinalsEditor
                    finals={finals}
                    bands={saved.bands}
                    days={days}
                    zoneLabel={zoneLabel}
                    breaks={breaks}
                    readyText={finalsReadyText}
                    readyMinutes={finalsReadyMinutes}
                    onReadyText={(v) => {
                      setFinalsReadyText(v);
                      touched();
                    }}
                    onChange={(next) => {
                      setFinals(next);
                      touched();
                    }}
                    onOpenBreak={(key) => openBreak(key, "finals")}
                    openBreakKey={breakOpenKey("finals")}
                    breakEditor={breakEditor}
                    published={finalsPublished}
                    revealed={finalistsRevealed}
                  />
                  {editActions()}
                  </>
                ) : saved.finals.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted">Does this contest have a finals round?</p>
                    <Button type="button" variant="secondary" disabled={busy} onClick={() => start({ kind: "finals" })}>
                      Set up finals
                    </Button>
                  </div>
                ) : (
                  <RoundRows
                    rows={finalsRows}
                    breaks={breaks}
                    readyMinutes={finalsReadyMinutes}
                    days={days}
                    editIndex={editing?.kind === "row" && editing.round === "finals" ? editing.index : null}
                    rowEditor={rowEditorFor("finals", saved.finals)}
                    canEdit={!busy}
                    onEditRow={(i) => editRow("finals", i)}
                    onOpenBreak={(key) => openBreak(key, "finals")}
                    openBreakKey={breakOpenKey("finals")}
                    breakEditor={breakEditor}
                  />
                )}
              </div>
            </TabPanel>
          )}
        </div>
      </div>

      {leaving && (
        <SwitchTabDialog
          saving={leaving.saving || pending}
          onClose={() => setLeaving(null)}
          onDiscard={() => {
            discard();
            setTab(leaving.to);
            setLeaving(null);
          }}
          onSave={async () => {
            if (
              revealing &&
              !(await confirmDialog({
                title: `Show ${revealing} more finalist name${revealing === 1 ? "" : "s"}?`,
                message: "Finalists are revealed, so saving shows them on the public schedule right away, and directors can see it.",
                confirmLabel: "Save",
                danger: true,
              }))
            )
              return setLeaving(null);
            setLeaving({ ...leaving, saving: true });
            onSave();
          }}
        />
      )}

      <PublishBar>
        {changes && (
          <ChangeNotice
            names={[...new Set([...changes.order, ...changes.finals])].map((id) => saved.bands.find((b) => b.id === id)?.name ?? "A band")}
            onSend={async () => {
              const r = await emailChanges(changes);
              setResult(r);
              if (r.ok) setChanges(null);
            }}
            onDismiss={() => setChanges(null)}
          />
        )}
        {!editing && <FormMessage error={result.error} success={result.ok ? result.message : null} />}
        {editing && <p className="text-sm text-muted">Save or cancel your changes first, then publish.</p>}
        <div className="space-y-2">
          <PublishLine label="Preliminaries" status={orderPublished ? "Published" : "Not published"} on={orderPublished}>
            {orderPublished ? (
              <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy || pending} onClick={() => run(() => publishOrder(false))}>
                Unpublish
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-9 px-3"
                disabled={busy || pending}
                onClick={() => {
                  const unscheduled = saved.bands.filter((b) => !b.perform).length;
                  run(
                    () => publishOrder(true),
                    unscheduled
                      ? `${unscheduled} band(s) don't have a performance time yet. Publish anyway? Each director will be emailed their times.`
                      : "Publish the preliminaries? Each band director will be emailed their times.",
                  );
                }}
              >
                Publish
              </Button>
            )}
          </PublishLine>
          {saved.finals.length > 0 && (
            <PublishLine
              label="Finals"
              on={finalsPublished}
              status={
                finalistsRevealed
                  ? "Finalists revealed"
                  : finalsPublished
                    ? `Schedule published, finalists not revealed (${picked} of ${saved.finals.length} saved)`
                    : "Schedule not published"
              }
            >
              {!finalsPublished ? (
                <Button type="button" className="min-h-9 px-3" disabled={busy || pending} onClick={() => run(() => publishFinals(true))}>
                  Publish schedule
                </Button>
              ) : !finalistsRevealed ? (
                <>
                  <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy || pending} onClick={() => run(() => publishFinals(false))}>
                    Unpublish
                  </Button>
                  <Button
                    type="button"
                    variant="warn"
                    className="min-h-9 px-3"
                    disabled={busy || pending || picked === 0}
                    onClick={() =>
                      run(
                        () => revealFinalists(true),
                        `Reveal ${picked} finalist${picked === 1 ? "" : "s"}? Their names will show on the public schedule and their directors will see it right away.`,
                      )
                    }
                  >
                    Reveal {picked}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-9 px-3"
                    disabled={busy || pending}
                    onClick={() => run(() => revealFinalists(false), "Hide the finalist names again? The finals times stay published.")}
                  >
                    Hide names
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-9 px-3"
                    disabled={busy || pending || picked === 0}
                    onClick={() => run(emailFinalists, `Email the ${picked} finalist band director(s) their finals times?`)}
                  >
                    Email finalists
                  </Button>
                </>
              )}
            </PublishLine>
          )}
        </div>
      </PublishBar>
    </div>
  );
}

function editingLabel(e: NonNullable<Editing>, saved: Snapshot) {
  switch (e.kind) {
    case "prelims":
      return "Editing preliminaries";
    case "finals":
      return "Editing finals";
    case "break":
      return e.isNew ? "Adding a break" : `Editing break: ${e.draft.label || "Break"}`;
    case "row":
      return e.round === "order"
        ? `Editing ${saved.bands[e.index]?.name ?? "band"}`
        : `Editing finals slot F${e.index + 1}`;
  }
}

function liveNote(e: NonNullable<Editing>, orderPublished: boolean, finalsPublished: boolean) {
  if (e.kind === "prelims" || (e.kind === "row" && e.round === "order")) return orderPublished;
  if (e.kind === "finals" || e.kind === "row") return finalsPublished;
  return orderPublished || finalsPublished;
}

function saveLabel(e: NonNullable<Editing>) {
  switch (e.kind) {
    case "prelims":
      return "Save preliminaries";
    case "finals":
      return "Save finals";
    case "break":
      return e.remove ? "Remove break" : "Save break";
    case "row":
      return "Save";
  }
}

/** Breaks apply to the whole contest day: preliminaries and finals. */
function BreaksList({
  breaks,
  canEdit,
  openKey,
  adding,
  breakEditor,
  onOpen,
  onAdd,
}: {
  breaks: BreakDraft[];
  canEdit: boolean;
  openKey: number | null;
  adding: BreakDraft | null;
  breakEditor: ReactNode;
  onOpen: (key: number) => void;
  onAdd: () => void;
}) {
  const sorted = [...breaks].sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
  return (
    <div className="space-y-3">
      {sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.map((b) => (
            <li key={b.key}>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onOpen(b.key)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-default ${openKey === b.key ? "border-brand" : "border-border hover:border-brand"}`}
              >
                <LineIcon name="coffee" className="size-4" />
                <span className="flex-1 font-medium">{b.label || "Break"}</span>
                <span className="tabular-nums text-muted">
                  {formatDate(b.day, { year: undefined, weekday: undefined })} · {breakRange(b)}
                </span>
              </button>
              {openKey === b.key && breakEditor}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        breakEditor
      ) : (
        <Button type="button" variant="secondary" disabled={!canEdit} onClick={onAdd}>
          + Add a break
        </Button>
      )}
    </div>
  );
}

type Tab = "prelims" | "finals";

/** The schedule's tabs, like the tabs on Volunteer Setup and Band Registration. */
function ScheduleTabs({
  tabs,
  current,
  onPick,
}: {
  tabs: { key: Tab; label: string; status: string; mark?: "done" | "todo" }[];
  current: Tab;
  onPick: (tab: Tab) => void;
}) {
  return (
    <nav aria-label="Schedule" className="relative -mx-4 overflow-x-auto px-4 pt-1 sm:mx-0 sm:px-0">
      <ul className={folderTabRow}>
        {tabs.map((t) => (
          <li key={t.key}>
            <button
              type="button"
              aria-current={t.key === current ? "page" : undefined}
              onClick={() => onPick(t.key)}
              className={folderTab(t.key === current)}
            >
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                {t.mark === "done" && <span aria-hidden>✓</span>}
                {t.label}
              </span>
              <span className={folderTabNote(t.mark === "todo")}>
                {t.mark === "todo" && <span aria-hidden>◆ </span>}
                {t.status}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One tab's card: its title, what it's for, the day's breaks, and the round. */
function TabPanel({ title, intro, breaks, children }: { title: string; intro: string; breaks: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 mb-4 text-sm text-muted">{intro}</p>
      <div className="mb-5 border-b border-border pb-5">
        <h3 className="font-semibold">Breaks</h3>
        <p className="mt-1 mb-3 text-sm text-muted">
          Lunch, judges&apos; breaks, awards, for the whole day: the same breaks show in the preliminaries and the finals.
          Filling in times skips over them. Tap a break to change it.
        </p>
        {breaks}
      </div>
      {children}
    </section>
  );
}

/** Another tab, with something here changed and not saved: save it first, or switch without it. */
function SwitchTabDialog({ saving, onClose, onDiscard, onSave }: { saving: boolean; onClose: () => void; onDiscard: () => void; onSave: () => void }) {
  return createPortal(
    <dialog
      ref={(d) => {
        if (d && !d.open) d.showModal();
      }}
      onCancel={(e) => saving && e.preventDefault()}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
      aria-labelledby="switch-tab-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-6 text-foreground shadow-elevated backdrop:bg-[#071a31]/50"
    >
      <h2 id="switch-tab-title" className="text-xl font-semibold">
        Save your changes first?
      </h2>
      <p className="mt-3 leading-7 text-muted">
        You changed something here and didn&apos;t save it. Save it before you switch tabs, or switch without it.
      </p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:whitespace-nowrap">
        <Button type="button" variant="danger" disabled={saving} onClick={onDiscard}>
          Discard changes and switch
        </Button>
        <Button type="button" disabled={saving} aria-busy={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save and switch"}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}

/** The "fill in times automatically" panel, for the preliminaries or the finals. */
function AutoFill({
  title,
  noun,
  count,
  days,
  defaultDay,
  defaultFirst,
  zoneLabel,
  breaks,
  readyText,
  readyHint,
  onReadyText,
  onFill,
  extraAction,
}: {
  title: string;
  /** What's being filled, e.g. "bands" or "finals slots". */
  noun: string;
  count: number;
  days: string[];
  defaultDay: string;
  defaultFirst: string;
  zoneLabel: string;
  breaks: BreakDraft[];
  readyText: string;
  readyHint: string;
  onReadyText: (v: string) => void;
  onFill: (times: Partial<Times>[]) => void;
  /** Another button shown next to "Fill in times". */
  extraAction?: ReactNode;
}) {
  const [auto, setAuto] = useState({ day: defaultDay, first: defaultFirst, slot: "15", warmUp: "60", duration: 45, location: "" });
  const slot = Number(auto.slot) || 15;
  const warmUp = Number(auto.warmUp) || 0;
  const readyMinutes = Number(readyText) || 0;
  // "Field A, Field B" alternates between the listed locations, band by band.
  const locations = auto.location
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  const dayBreaks = breakSpans(breaks, auto.day);

  const fill = () =>
    onFill(
      performTimes(count, toMinutes(auto.first), slot, dayBreaks).map((perform, i) => ({
        day: auto.day,
        perform: toTime(perform),
        warmUp: toTime(perform - warmUp),
        warmUpMinutes: auto.duration,
        ...(locations.length ? { location: locations[i % locations.length] } : {}),
      })),
    );

  return (
    <Accordion title={title} defaultOpen>
      <div className="grid gap-4 sm:grid-cols-2">
        {days.length > 1 && (
          <Field label="Day">
            <Select value={auto.day} onChange={(e) => setAuto({ ...auto, day: e.target.value })}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={`First performance (${zoneLabel})`}>
          <TimeField value={auto.first} onChange={(e) => setAuto({ ...auto, first: e.target.value })} />
        </Field>
        <Field label="Minutes between bands" hint={dayBreaks.length ? `Skips ${dayBreaks.map((b) => b.label).join(", ")}.` : undefined}>
          <NumberInput maxLength={3} value={auto.slot} onChange={(e) => setAuto({ ...auto, slot: e.target.value })} />
        </Field>
        <Field label="Warm-up starts (minutes before performing)">
          <NumberInput maxLength={3} value={auto.warmUp} onChange={(e) => setAuto({ ...auto, warmUp: e.target.value })} />
        </Field>
        <Field
          label="Warm-up duration"
          hint={
            auto.duration > warmUp - readyMinutes
              ? <><LineIcon name="warning" inline />That runs past the ready position ({readyMinutes} min before performing).</>
              : `Leaves ${warmUp - auto.duration - readyMinutes} min to reach the ready position.`
          }
        >
          <Select value={auto.duration} onChange={(e) => setAuto({ ...auto, duration: Number(e.target.value) })}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {formatDuration(d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ready position (minutes before performing)" hint={readyHint}>
          <NumberInput maxLength={2} value={readyText} onChange={(e) => onReadyText(e.target.value)} />
        </Field>
        <Field
          label="Warm-up location"
          hint={
            locations.length > 1
              ? `Bands alternate: ${locations.join(" → ")} → ${locations[0]}…`
              : "Optional. Separate several with commas to alternate bands between them. Leave blank to keep each band's."
          }
        >
          <Input value={auto.location} onChange={(e) => setAuto({ ...auto, location: e.target.value })} placeholder="e.g. Practice Field A, Practice Field B" />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" onClick={fill}>
          Fill in times for all {count} {noun}
        </Button>
        {extraAction}
      </div>
    </Accordion>
  );
}

function FinalsEditor({
  finals,
  bands,
  days,
  zoneLabel,
  breaks,
  readyText,
  readyMinutes,
  onReadyText,
  onChange,
  onOpenBreak,
  openBreakKey,
  breakEditor,
  published,
  revealed,
}: {
  finals: FinalsSlot[];
  bands: OrderBand[];
  days: string[];
  zoneLabel: string;
  breaks: BreakDraft[];
  readyText: string;
  readyMinutes: number;
  onReadyText: (v: string) => void;
  onChange: (next: FinalsSlot[]) => void;
  onOpenBreak: (key: number) => void;
  openBreakKey: number | null;
  breakEditor: ReactNode;
  published: boolean;
  /** Finalists revealed: picked names go public on save. */
  revealed: boolean;
}) {
  const [countText, setCountText] = useState(finals.length ? String(finals.length) : "");
  const lastDay = days.at(-1)!;
  const blank = (): FinalsSlot => ({ ...blankTimes(finals.at(-1)?.day ?? lastDay), bandId: "" });
  const edit = (i: number, patch: Partial<FinalsSlot>) => onChange(finals.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  // Resize when the host finishes typing, so typing "12" doesn't first cut the list to 1.
  const applyCount = async () => {
    const n = Math.min(Math.max(Number(countText) || 0, 1), MAX_FINALISTS);
    setCountText(String(n));
    if (n === finals.length) return;
    const dropped = finals.slice(n).filter((f) => f.bandId || f.perform).length;
    if (
      dropped &&
      !(await confirmDialog({
        title: `Remove the last ${finals.length - n} finals ${finals.length - n === 1 ? "slot" : "slots"} and their times?`,
        confirmLabel: "Remove",
        danger: true,
      }))
    ) {
      setCountText(String(finals.length));
      return;
    }
    onChange(n < finals.length ? finals.slice(0, n) : [...finals, ...Array.from({ length: n - finals.length }, blank)]);
  };

  if (finals.length === 0) {
    const validCount = Number(countText) >= 1 && Number(countText) <= MAX_FINALISTS;
    const addRound = () => onChange(Array.from({ length: Number(countText) }, () => ({ ...blankTimes(lastDay), bandId: "" })));
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Choose how many bands advance, then set the slot times. Pick the finalist bands once they&apos;re announced.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Number of finalists (1–${MAX_FINALISTS})`} className="w-56">
            <NumberInput
              maxLength={2}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (validCount) addRound();
                }
              }}
              placeholder="e.g. 6"
            />
          </Field>
          <Button type="button" variant="secondary" disabled={!validCount} onClick={addRound}>
            + Add finals slots
          </Button>
        </div>
      </div>
    );
  }

  const taken = new Set(finals.map((f) => f.bandId).filter(Boolean));

  return (
    <div className="space-y-6">
      <FinalistPrivacyNote published={published} revealed={revealed} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Number of finalists" className="max-w-xs" hint={`1 to ${MAX_FINALISTS}.`}>
          <NumberInput
            maxLength={2}
            value={countText}
            onChange={(e) => setCountText(e.target.value)}
            onBlur={applyCount}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCount();
              }
            }}
          />
        </Field>
        <Button
          type="button"
          variant="danger"
          onClick={async () => {
            if (
              await confirmDialog({
                title: "Remove the finals round and its times?",
                message: "This takes effect when you save.",
                confirmLabel: "Remove finals",
                danger: true,
              })
            ) {
              setCountText("");
              onChange([]);
            }
          }}
        >
          Remove finals
        </Button>
      </div>
      <AutoFill
        title="Fill in finals times automatically"
        noun={finals.length === 1 ? "finals slot" : "finals slots"}
        count={finals.length}
        days={days}
        defaultDay={finals[0].day || lastDay}
        defaultFirst="18:00"
        zoneLabel={zoneLabel}
        breaks={breaks}
        readyText={readyText}
        readyHint="Same for every finalist, 0 to 60. Can differ from the preliminaries."
        onReadyText={onReadyText}
        onFill={(times) => onChange(finals.map((f, i) => ({ ...f, ...times[i] })))}
      />
      <ol className="space-y-3">
        {finals.map((f, i) => (
          <BreakDividers
            key={i}
            breaks={breaks}
            prev={finals[i - 1]}
            cur={f}
            onOpenBreak={onOpenBreak}
            openBreakKey={openBreakKey}
            breakEditor={breakEditor}
          >
            <li className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                  F{i + 1}
                </span>
                <Field label={`Finalist ${i + 1}`} className="min-w-0 flex-1">
                  <Select value={f.bandId} onChange={(e) => edit(i, { bandId: e.target.value })}>
                    <option value="">To be announced</option>
                    {bands.map((b) => (
                      <option key={b.id} value={b.id} disabled={taken.has(b.id) && b.id !== f.bandId}>
                        {b.name} ({b.school})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <TimesEditor value={f} days={days} breaks={breaks} readyMinutes={readyMinutes} onChange={(patch) => edit(i, patch)} />
            </li>
          </BreakDividers>
        ))}
      </ol>
    </div>
  );
}

/** After saving changes to published times: offer to email the affected directors. */
function ChangeNotice({ names, onSend, onDismiss }: { names: string[]; onSend: () => Promise<void>; onDismiss: () => void }) {
  const [sending, setSending] = useState(false);
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3" role="status">
      <p className="text-sm font-medium">
        Times changed for {names.length} {names.length === 1 ? "band" : "bands"}: {list}.
      </p>
      <p className="mt-0.5 text-sm text-muted">Their directors haven&apos;t been told yet.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary"
          className="min-h-9 px-3"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            await onSend();
            setSending(false);
          }}
        >
          {sending ? "Sending…" : `Email ${names.length === 1 ? "their director" : "their directors"}`}
        </Button>
        <Button type="button" variant="ghost" className="min-h-9 px-3" onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/**
 * How a break change moves the timing after it: adding pushes later
 * performances back by its length, removing pulls them forward, and changing
 * it moves them by how much its end time moved. Same day only.
 */
function breakShift(e: Extract<NonNullable<Editing>, { kind: "break" }>, savedBreaks: BreakDraft[]) {
  const mins = (b: BreakDraft) => Number(b.minutes) || 0;
  const old = e.isNew ? undefined : savedBreaks.find((b) => b.key === e.key);
  if (e.remove && old?.start) return { delta: -mins(old), day: old.day, pivot: toMinutes(old.start) };
  if (!e.draft.start) return { delta: 0, day: e.draft.day, pivot: 0 };
  if (!old?.start) return { delta: mins(e.draft), day: e.draft.day, pivot: toMinutes(e.draft.start) };
  if (old.day !== e.draft.day) return { delta: 0, day: old.day, pivot: 0 };
  const end = (b: BreakDraft) => toMinutes(b.start) + mins(b);
  return { delta: end(e.draft) - end(old), day: old.day, pivot: Math.min(toMinutes(old.start), toMinutes(e.draft.start)) };
}

/** When picked finalist names become public. */
function FinalistPrivacyNote({ published, revealed }: { published: boolean; revealed: boolean }) {
  if (revealed)
    return (
      <p className="rounded-lg border border-danger px-3 py-2 text-sm text-danger">
        <LineIcon name="warning" inline />Finalists are revealed. A band you pick here is shown on the public schedule as soon as you save.
      </p>
    );
  return (
    <p className="rounded-lg bg-background px-3 py-2 text-sm text-muted">
      {published
        ? "The finals schedule is public, but finalist names stay private: Save only keeps them that way. Save & reveal (or Reveal in the footer) shows them."
        : "Finalist names stay private until you reveal them. You can publish the finals schedule first, with \u201cto be announced\u201d placeholders."}
    </p>
  );
}
