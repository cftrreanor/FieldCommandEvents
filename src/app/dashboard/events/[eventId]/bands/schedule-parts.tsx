"use client";

import type { ReactNode } from "react";
import { NumberInput } from "@/components/number-input";
import { Field, Input, Select } from "@/components/ui";
import { displayTime, formatDuration, toMinutes, toTime, type Span } from "@/lib/schedule";
import { formatDate } from "@/lib/time";
import { LineIcon } from "@/components/line-icon";
import { TimeField } from "@/components/time-field";

// Pieces shared by the schedule builder (editing) and the schedule view
// (published, read-only with per-band edits).

/** A band's (or finals slot's) times, as wall-clock times on the event's days. */
export type Times = {
  day: string;
  warmUp: string;
  /** Warm-up length in minutes (15-minute steps), or 0 if not set. */
  warmUpMinutes: number;
  perform: string;
  location: string;
};

export type OrderBand = Times & {
  id: string;
  name: string;
  school: string;
  classification: string;
  conflicts: string | null;
};

/** A finals slot: times now, the band once finalists are announced ("" = to be announced). */
export type FinalsSlot = Times & { bandId: string };

export type ScheduleBreak = { day: string; start: string; minutes: number; label: string };

export type BreakDraft = { key: number; day: string; start: string; minutes: string; label: string };

export const DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15); // 15 min … 4 hours
/** Breaks on one day, as minute spans, skipping any that aren't filled in yet. */
export function breakSpans(breaks: BreakDraft[], day: string): (Span & { label: string; key: number })[] {
  return breaks
    .filter((b) => b.day === day && b.start && Number(b.minutes) > 0)
    .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.start) + Number(b.minutes), label: b.label || "Break", key: b.key }))
    .sort((a, b) => a.start - b.start);
}

export function TimesEditor({
  value: v,
  days,
  breaks,
  readyMinutes,
  onChange,
}: {
  value: Times;
  days: string[];
  breaks: BreakDraft[];
  readyMinutes: number;
  onChange: (patch: Partial<Times>) => void;
}) {
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {days.length > 1 && (
          <Field label="Day">
            <Select value={v.day} onChange={(e) => onChange({ day: e.target.value })}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d, { year: undefined })}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Warm-up starts">
          <TimeField value={v.warmUp} onChange={(e) => onChange({ warmUp: e.target.value })} />
        </Field>
        <Field label="Warm-up length">
          <Select value={v.warmUpMinutes || ""} onChange={(e) => onChange({ warmUpMinutes: Number(e.target.value) || 0 })}>
            <option value="">Not set</option>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {formatDuration(d)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Performs">
          <TimeField value={v.perform} onChange={(e) => onChange({ perform: e.target.value })} />
        </Field>
        <Field label="Warm-up location" className="col-span-2 sm:col-span-4">
          <Input value={v.location} onChange={(e) => onChange({ location: e.target.value })} />
        </Field>
      </div>
      <Timeline times={v} readyMinutes={readyMinutes} breaks={breaks} />
    </>
  );
}

/** Warm-up → ends → ready → performs, worked out from the times. */
export function Timeline({ times: t, readyMinutes, breaks }: { times: Times; readyMinutes: number; breaks: BreakDraft[] }) {
  if (!t.warmUp && !t.perform) return null;
  const warmEnd = t.warmUp && t.warmUpMinutes ? toTime(toMinutes(t.warmUp) + t.warmUpMinutes) : null;
  const ready = t.perform ? toTime(toMinutes(t.perform) - readyMinutes) : null;
  const overlap = warmEnd && ready && toMinutes(warmEnd) > toMinutes(ready);
  const during = t.perform
    ? breakSpans(breaks, t.day).find((b) => toMinutes(t.perform) >= b.start && toMinutes(t.perform) < b.end)
    : undefined;
  const steps = [
    t.warmUp && ["Warm-up", displayTime(t.warmUp)],
    warmEnd && ["Warm-up ends", displayTime(warmEnd)],
    ready && ["Ready position", displayTime(ready)],
    t.perform && ["Performs", displayTime(t.perform)],
  ].filter(Boolean) as [string, string][];
  return (
    <div className="mt-3 rounded-lg bg-background px-3 py-2 text-sm">
      <p className="flex flex-wrap gap-x-2 gap-y-1">
        {steps.map(([label, time], k) => (
          <span key={label} className="whitespace-nowrap">
            {k > 0 && <span className="mr-2 text-muted">→</span>}
            <span className="text-muted">{label}</span> <span className="font-medium">{time}</span>
          </span>
        ))}
      </p>
      {overlap && <p className="mt-1 text-danger"><LineIcon name="warning" inline />Warm-up runs past the ready position.</p>}
      {during && (
        <p className="mt-1 text-danger">
          <LineIcon name="warning" inline />Performs during {during.label} ({displayTime(toTime(during.start))} – {displayTime(toTime(during.end))}).
        </p>
      )}
    </div>
  );
}

/**
 * Shows any break that falls between the previous performance and this one,
 * then this one. With onOpenBreak, each break is a button that opens it for
 * editing; the open one shows `breakEditor` underneath.
 */
export function BreakDividers({
  breaks,
  prev,
  cur,
  children,
  onOpenBreak,
  openBreakKey,
  breakEditor,
}: {
  breaks: BreakDraft[];
  prev: Times | undefined;
  cur: Times;
  children: ReactNode;
  onOpenBreak?: (key: number) => void;
  openBreakKey?: number | null;
  breakEditor?: ReactNode;
}) {
  const between =
    prev && prev.perform && cur.perform && prev.day === cur.day
      ? breakSpans(breaks, cur.day).filter((b) => b.start >= toMinutes(prev.perform) && b.start < toMinutes(cur.perform))
      : [];
  return (
    <>
      {between.map((b) => {
        const label = (
          <>
            <span className="h-px flex-1 bg-border" />
            <span className="whitespace-nowrap font-medium">
              <LineIcon name="coffee" inline />{b.label} · {displayTime(toTime(b.start))} – {displayTime(toTime(b.end))}
            </span>
            <span className="h-px flex-1 bg-border" />
          </>
        );
        return (
          <li key={b.key} className="text-sm text-muted">
            {onOpenBreak ? (
              <button
                type="button"
                onClick={() => onOpenBreak(b.key)}
                className="flex w-full items-center gap-3 rounded-lg px-1 py-1 hover:bg-surface hover:text-foreground"
                aria-label={`Edit break: ${b.label}`}
              >
                {label}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-1">{label}</div>
            )}
            {openBreakKey === b.key && breakEditor}
          </li>
        );
      })}
      {children}
    </>
  );
}

/** Day / start / length / name for one break. */
export function BreakForm({
  value: b,
  days,
  zoneLabel,
  onChange,
}: {
  value: BreakDraft;
  days: string[];
  zoneLabel: string;
  onChange: (patch: Partial<BreakDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {days.length > 1 && (
        <Field label="Day">
          <Select value={b.day} onChange={(e) => onChange({ day: e.target.value })}>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDate(d, { year: undefined })}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`Starts (${zoneLabel})`}>
        <TimeField required value={b.start} onChange={(e) => onChange({ start: e.target.value })} />
      </Field>
      <Field label="Minutes">
        <NumberInput maxLength={3} value={b.minutes} onChange={(e) => onChange({ minutes: e.target.value })} />
      </Field>
      <Field label="Name" className={days.length > 1 ? "" : "sm:col-span-2"}>
        <Input value={b.label} maxLength={80} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Lunch" />
      </Field>
    </div>
  );
}

/** A collapsible panel in the schedule (Breaks, Fill in times…), all with the same header style. */
export function Accordion({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Short summary shown next to the title, e.g. "2 breaks". */
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{title}</span>
        {meta && <span className="min-w-0 truncate text-sm text-muted">{meta}</span>}
        <span aria-hidden="true" className="ml-auto shrink-0 text-muted transition group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}
