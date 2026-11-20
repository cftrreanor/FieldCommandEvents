"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
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
 * one of this kind's events and "Duplicate event" becomes the one filled button; the blank form (`children`) folds
 * away behind "Or fill in the details yourself" (kept as typed). Picking alone changes nothing. Shown only when
 * there's an event to start from.
 */
export function StartFromEvent({ events, kindWords, children }: { events: PastEvent[]; kindWords: string; children: ReactNode }) {
  const [picked, setPicked] = useState("");
  const [showForm, setShowForm] = useState(false);
  const choice = events.find((e) => e.id === picked) ?? null;
  return (
    <>
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link
                  href={duplicateHref(choice.id, "new")}
                  className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-sm hover:brightness-95"
                >
                  Duplicate event
                </Link>
                <span className="text-sm text-muted">Next, you pick the new dates and see what comes over</span>
              </div>
            </>
          )}
        </div>
      </Card>
      {/* The same place in the page either way, so the form keeps what was typed. */}
      <div className={choice ? "mt-6" : undefined}>
        {choice && (
          // One main way on: the blank form folds away (still there, as typed).
          <button
            type="button"
            aria-expanded={showForm}
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
          >
            <span aria-hidden className={`inline-block transition-transform ${showForm ? "rotate-90" : ""}`}>
              ›
            </span>
            Or fill in the details yourself
          </button>
        )}
        <div hidden={Boolean(choice) && !showForm} className={choice ? "-mt-4" : undefined}>
          {children}
        </div>
      </div>
    </>
  );
}
