"use client";

import { useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11" for "2026-11-03". */
const monthOf = (day: string) => day.slice(0, 7);

/** The month n months after "2026-11", as "2027-01". */
function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** "Tuesday, November 3" for "2026-11-03" (the date as written, whatever the phone's time zone). */
export const longDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * A month calendar for weekly hours, like Calendly's: days with open times are
 * circled and can be picked; every other day is grayed out. Arrows move between
 * the months that have open times.
 */
export function DayCalendar({
  open,
  selected,
  onSelect,
}: {
  /** Days with open times ("2026-11-03") and how many are open. */
  open: Map<string, number>;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const days = [...open.keys()].sort();
  const first = monthOf(days[0] ?? "");
  const last = monthOf(days.at(-1) ?? "");
  const [month, setMonth] = useState(() => monthOf(selected || days[0] || ""));

  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  const arrow = "flex h-11 w-11 items-center justify-center rounded-full text-lg text-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent";
  return (
    <div className="w-full max-w-[22rem]">
      <div className="flex items-center justify-between">
        <button type="button" className={arrow} onClick={() => setMonth(addMonths(month, -1))} disabled={month <= first} aria-label="Previous month">
          ‹
        </button>
        <p className="font-semibold" aria-live="polite">
          {title}
        </p>
        <button type="button" className={arrow} onClick={() => setMonth(addMonths(month, 1))} disabled={month >= last} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-x-1.5 gap-y-1.5 text-center" role="group" aria-label={title}>
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden className="pb-1 text-xs font-semibold uppercase text-muted">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} />;
          const count = open.get(day) ?? 0;
          const on = day === selected;
          const n = Number(day.slice(8));
          return (
            <span key={day} className="flex justify-center">
              <button
                type="button"
                disabled={!count}
                aria-pressed={count ? on : undefined}
                aria-label={count ? `${longDay(day)}, ${count} ${count === 1 ? "time" : "times"} open` : `${longDay(day)}, not available`}
                onClick={() => onSelect(day)}
                className={`flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-sm tabular-nums transition ${
                  on
                    ? "bg-brand font-semibold text-brand-foreground"
                    : count
                      ? "bg-brand-soft font-semibold text-brand ring-1 ring-brand/40 hover:ring-2 hover:ring-brand"
                      : "cursor-default text-muted opacity-50"
                }`}
              >
                {n}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
