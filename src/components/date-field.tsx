"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatDay, isoDay, longDay, parseDate, todayIso } from "@/lib/date-input";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fieldClass =
  "min-h-11 w-full rounded-sm border border-field-border bg-surface pl-3 pr-12 text-base outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand/25 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-background disabled:text-disabled";

/** The day n days after "2026-11-16". */
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The same day n months on (clamped to the month's last day). */
function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDay(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(d, last))!;
}

type ChangeEvent = { target: { value: string; name?: string } };

/**
 * A date box in our own style (issue #347), in place of the browser's date picker: type a date ("11/16",
 * "Nov 16") or pick one from a month calendar that opens from the button inside the box. Once picked it reads
 * in words ("Mon, Nov 16, 2026"). The form gets the same value the browser's picker sent ("2026-11-16") from a
 * hidden input with `name`, so it drops in where `<Input type="date">` was. Works controlled (`value` and
 * `onChange`, which gets `{ target: { value } }`) or not (`defaultValue`).
 */
export function DateField({
  name,
  value,
  defaultValue = "",
  onChange,
  min,
  max,
  required,
  disabled,
  id,
  className = "",
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue);
  const current = controlled ? value : own;
  // What's typed, while typing; otherwise the value in words.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? formatDay(current);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const boxId = id ?? `date-${autoId}`;
  const calId = `${boxId}-calendar`;
  const errId = `${boxId}-problem`;

  // A form reset (after a save) puts the box back to where it started.
  useEffect(() => {
    const form = input.current?.form;
    if (!form || controlled) return;
    const reset = () => {
      setOwn(defaultValue);
      setTyped(null);
      setProblem(null);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  const outOfRange = (iso: string) => (min && iso < min) || (max && iso > max);
  const rangeWords = min && max ? `from ${formatDay(min)} to ${formatDay(max)}` : min ? `on or after ${formatDay(min)}` : `on or before ${formatDay(max!)}`;

  const commit = useCallback(
    (iso: string) => {
      if (!controlled) setOwn(iso);
      onChange?.({ target: { value: iso, name } });
      setTyped(null);
      setProblem(null);
    },
    [controlled, onChange, name],
  );

  // The visible box tells the browser (and the red-after-a-try styling) when it can't be used.
  useEffect(() => {
    input.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  const readTyped = () => {
    if (typed === null) return;
    const t = typed.trim();
    if (!t) {
      if (current) commit("");
      return;
    }
    const iso = parseDate(t);
    if (!iso) return setProblem("Enter a date like 11/16/2026, or pick one from the calendar.");
    if (outOfRange(iso)) return setProblem(`Pick a date ${rangeWords}.`);
    setTyped(null);
    commit(iso);
  };

  // Close when focus or a tap goes elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <input
        ref={input}
        id={boxId}
        type="text"
        inputMode="text"
        autoComplete="off"
        value={text}
        required={required}
        disabled={disabled}
        placeholder="mm/dd/yyyy"
        aria-label={ariaLabel}
        aria-invalid={problem ? true : undefined}
        aria-describedby={[describedBy, problem ? errId : null].filter(Boolean).join(" ") || undefined}
        onChange={(e) => {
          setTyped(e.target.value);
          if (problem) setProblem(null);
        }}
        onBlur={readTyped}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            readTyped();
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={fieldClass}
      />
      {name && <input type="hidden" name={name} value={current} />}
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={current ? `Change the date, ${longDay(current)}` : "Choose a date"}
        aria-expanded={open}
        aria-controls={calId}
        onClick={() => setOpen((o) => !o)}
        className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-r-sm text-brand hover:bg-brand-soft disabled:text-disabled dark:text-foreground"
      >
        <CalendarIcon />
      </button>
      {problem && (
        <p id={errId} className="mt-1 text-sm font-semibold text-danger">
          {problem}
        </p>
      )}
      {open && (
        <Calendar
          id={calId}
          selected={current}
          min={min}
          max={max}
          onPick={(iso) => {
            commit(iso);
            setOpen(false);
            input.current?.focus();
          }}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** The month calendar under a DateField: days as buttons, arrow keys move between them. */
function Calendar({
  id,
  selected,
  min,
  max,
  onPick,
  onClose,
}: {
  id: string;
  selected: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const today = todayIso();
  const start = selected || (min && today < min ? min : max && today > max ? max : today);
  const [focusDay, setFocusDay] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const month = focusDay.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const blocked = (iso: string) => !!((min && iso < min) || (max && iso > max));

  // Keep keyboard focus on the day being moved to.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  const move = (n: number, by: "day" | "month" = "day") => {
    const next = by === "day" ? addDays(focusDay, n) : addMonths(focusDay, n);
    setFocusDay(next);
  };
  const keys = (e: KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => move(-1),
      ArrowRight: () => move(1),
      ArrowUp: () => move(-7),
      ArrowDown: () => move(7),
      PageUp: () => move(-1, "month"),
      PageDown: () => move(1, "month"),
      Home: () => move(-new Date(`${focusDay}T12:00:00Z`).getUTCDay()),
      End: () => move(6 - new Date(`${focusDay}T12:00:00Z`).getUTCDay()),
      Escape: onClose,
    };
    const act = map[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  };
  const arrow = "flex h-11 w-11 items-center justify-center rounded-full text-lg text-brand hover:bg-brand-soft dark:text-foreground";

  return (
    <div
      id={id}
      role="dialog"
      aria-label={`Choose a date, ${title}`}
      className="absolute left-0 z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-field-border bg-surface p-3 shadow-elevated"
    >
      <div className="flex items-center justify-between">
        <button type="button" className={arrow} onClick={() => move(-1, "month")} aria-label="Previous month">
          ‹
        </button>
        <p className="font-semibold" aria-live="polite">
          {title}
        </p>
        <button type="button" className={arrow} onClick={() => move(1, "month")} aria-label="Next month">
          ›
        </button>
      </div>
      <div ref={grid} role="grid" aria-label={title} onKeyDown={keys} className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden className="pb-1 text-xs font-semibold uppercase text-muted">
            {d}
          </span>
        ))}
        {cells.map((day, i) => {
          if (!day) return <span key={`blank-${i}`} />;
          const on = day === selected;
          const off = blocked(day);
          return (
            <span key={day} className="flex justify-center">
              <button
                type="button"
                data-day={day}
                tabIndex={day === focusDay ? 0 : -1}
                disabled={off}
                aria-pressed={on}
                aria-current={day === today ? "date" : undefined}
                aria-label={`${longDay(day)}${day === today ? ", today" : ""}${off ? ", not available" : ""}`}
                onClick={() => onPick(day)}
                className={`flex aspect-square w-full max-w-10 items-center justify-center rounded-full text-sm tabular-nums ${
                  on
                    ? "bg-brand font-semibold text-brand-foreground"
                    : off
                      ? "cursor-not-allowed text-disabled line-through decoration-1"
                      : `font-medium hover:bg-brand-soft ${day === today ? "ring-1 ring-brand" : ""}`
                }`}
              >
                {Number(day.slice(8))}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm">
        <button
          type="button"
          disabled={blocked(today)}
          onClick={() => onPick(today)}
          className="min-h-11 px-2 font-semibold text-brand underline-offset-4 hover:underline disabled:text-disabled disabled:no-underline dark:text-foreground"
        >
          Today
        </button>
        <button type="button" onClick={onClose} className="min-h-11 px-2 font-semibold text-muted underline-offset-4 hover:underline">
          Close
        </button>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 6h14v13H5zM5 10h14M9 4v4M15 4v4" />
    </svg>
  );
}
