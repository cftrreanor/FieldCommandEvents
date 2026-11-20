"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Field, Select } from "@/components/ui";
import { duplicateHref } from "@/lib/duplicate-words";

export type PastEvent = {
  id: string;
  name: string;
  /** "Sat, Nov 21, 2026" (the first day, for the dropdown). */
  date: string;
  /** "Sat–Sun, Nov 21–22, 2026" */
  dates: string;
  venue: string | null;
  /** "4 jobs, 9 shifts, 3 things to bring, 2 files, and 2 Coordinators" */
  summary: string;
};

/**
 * New event, step 1: "Start from one of your events" for every kind with jobs (Duplicate event, 2026-11-20). Pick
 * one of this kind's events and Duplicate event opens, where the new dates are picked and what comes over is shown.
 * Picking alone changes nothing. Shown only when there's an event to start from.
 */
export function StartFromEvent({ events, kindWords }: { events: PastEvent[]; kindWords: string }) {
  const [picked, setPicked] = useState("");
  const choice = events.find((e) => e.id === picked) ?? null;
  return (
    <Card className="mt-6">
      <h2 className="text-lg font-semibold">Start from one of your events</h2>
      <p className="mt-1 text-sm text-muted">Duplicate {kindWords} you&apos;ve run, on new dates. Or fill in the details below to start fresh.</p>
      <div className="mt-4 space-y-3">
        <Field label="Event to duplicate">
          <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
            <option value="">Start fresh</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.date} · {e.name}
              </option>
            ))}
          </Select>
        </Field>
        {choice && (
          <>
            {/* The whole choice, wrapped, since a phone cuts off the dropdown's text. */}
            <p className="text-sm">
              <span className="font-semibold">{choice.name}</span>
              <span className="block text-muted">
                {choice.dates}
                {choice.venue ? ` · ${choice.venue}` : ""}
              </span>
              <span className="block text-muted">{choice.summary}</span>
            </p>
            <Link
              href={duplicateHref(choice.id, "new")}
              className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand"
            >
              Duplicate event
            </Link>
            <p className="text-sm text-muted">Opens Duplicate event, where you pick the new dates and see what comes over.</p>
          </>
        )}
      </div>
    </Card>
  );
}
