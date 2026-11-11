"use client";

import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { dateProblem, formatDay, isoDay, longDay, parseDate, todayIso } from "@/lib/date-input";
import { LockIcon, PickerPopover, PickerProblem, makeRoom, pickerBoxClass, pickerButtonClass, useEditEvents, useFieldLabel, useTouchScreen } from "./picker-parts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
 * "Nov 16") or pick one from a month calendar that opens from the button inside the box (on touch screens, from
 * a tap on the box). Once picked it reads in words ("Mon, Nov 16, 2026"). The form gets the same value the
 * browser's picker sent ("2026-11-16") from a hidden input with `name`, so it drops in where
 * the browser's date box was. Works controlled (`value` and `onChange`, which gets `{ target: { value } }`) or not
 * (`defaultValue`). A value outside `min`/`max` is shown in red and stops the form saving, as the browser's did.
 */
export function DateField({
  name,
  value,
  defaultValue = "",
  onChange,
  onBlur,
  min,
  max,
  required,
  disabled,
  readOnly,
  autoFocus,
  id,
  className = "",
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue);
  // A new starting value from the page (after a save) replaces what's shown.
  const [seenDefault, setSeenDefault] = useState(defaultValue);
  if (!controlled && defaultValue !== seenDefault) {
    setSeenDefault(defaultValue);
    setOwn(defaultValue);
  }
  const current = controlled ? value : own;
  // What's typed, while typing; otherwise the value in words.
  const [typed, setTyped] = useState<string | null>(null);
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  // A value changed by the page clears anything half typed.
  const [seenValue, setSeenValue] = useState(value);
  if (controlled && value !== seenValue) {
    setSeenValue(value);
    setTyped(null);
    setTypedProblem(null);
  }
  const text = typed ?? formatDay(current);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const touch = useTouchScreen();
  const [typeMode, setTypeMode] = useState(false);
  const locked = !!(disabled || readOnly);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const edited = useEditEvents(wrap, current);
  const autoId = useId();
  const boxId = id ?? `date-${autoId}`;
  const calId = `${boxId}-calendar`;
  const errId = `${boxId}-problem`;
  const actionId = `${boxId}-action`;
  useFieldLabel(input, button, boxId, actionId, !!ariaLabel);

  const outOfRange = useCallback((iso: string) => !!((min && iso < min) || (max && iso > max)), [min, max]);
  const rangeWords = min && max ? `from ${formatDay(min)} to ${formatDay(max)}` : min ? `on or after ${formatDay(min)}` : `on or before ${formatDay(max ?? "")}`;
  const problem = typedProblem ?? (current && outOfRange(current) && !locked ? `Pick a date ${rangeWords}.` : null);

  // A form reset (after a save) puts the box back to where it started.
  useEffect(() => {
    const form = input.current?.form;
    if (!form || controlled) return;
    const reset = () => {
      setOwn(defaultValue);
      setTyped(null);
      setTypedProblem(null);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  // The visible box tells the browser (and the form's "Check this answer") when it can't be saved.
  useEffect(() => {
    input.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  const commit = (iso: string) => {
    if (current !== iso) edited();
    if (!controlled) setOwn(iso);
    onChange?.({ target: { value: iso, name } });
    setTyped(null);
    setTypedProblem(null);
  };

  const readTyped = () => {
    if (typed === null) return;
    const t = typed.trim();
    if (!t) {
      if (current) commit("");
      else setTyped(null);
      return;
    }
    let iso = parseDate(t);
    if (!iso) {
      const why = dateProblem(t);
      return setTypedProblem(why ? `${why} Check the day, or pick one from the calendar.` : "Enter a date like 3/14 or Mar 14, or pick one from the calendar.");
    }
    // No year typed and the next one is out of range: this year's may fit (an event earlier this year).
    if (outOfRange(iso)) {
      const thisYears = parseDate(t, `${todayIso().slice(0, 4)}-01-01`);
      if (thisYears && !outOfRange(thisYears)) iso = thisYears;
    }
    commit(iso);
  };

  const show = () => {
    if (locked || !wrap.current) return;
    makeRoom(wrap.current, 400);
    setAnchor(wrap.current);
  };
  const close = (focus?: "box" | "button") => {
    setAnchor(null);
    if (focus === "box") input.current?.focus();
    if (focus === "button") button.current?.focus();
  };

  // Close when focus or a tap goes elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setAnchor(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  const tapToPick = touch && !typeMode;

  return (
    <div ref={wrap} data-picker data-picker-open={open || undefined} className={`relative scroll-mt-24 ${className}`}>
      <input
        ref={input}
        id={boxId}
        type="text"
        inputMode={tapToPick ? "none" : "text"}
        autoComplete="off"
        data-picker-box
        value={text}
        required={required}
        readOnly={locked}
        autoFocus={autoFocus}
        placeholder="Pick a date"
        aria-label={ariaLabel}
        aria-disabled={locked || undefined}
        aria-invalid={problem || ariaInvalid === true || ariaInvalid === "true" ? true : undefined}
        aria-describedby={[describedBy, problem ? errId : null].filter(Boolean).join(" ") || undefined}
        onChange={(e) => {
          setTyped(e.target.value);
          if (typedProblem) setTypedProblem(null);
        }}
        onClick={() => {
          if (tapToPick && !open) show();
        }}
        onBlur={(e) => {
          readTyped();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            readTyped();
          } else if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            show();
          } else if (e.key === "Escape") {
            // Close the calendar first; then put back the saved date. Never close the window behind.
            if (open) close();
            else if (typed !== null) {
              setTyped(null);
              setTypedProblem(null);
            } else return;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className={pickerBoxClass}
      />
      {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
      <span id={actionId} hidden>
        {locked ? "Can't change" : current ? "Change the date for" : "Pick a date for"}
      </span>
      <button
        ref={button}
        type="button"
        disabled={locked}
        aria-label={locked ? "Can't be changed" : current ? `Change the date, ${longDay(current)}` : "Pick a date"}
        aria-expanded={open}
        aria-controls={open ? calId : undefined}
        onClick={() => (open ? close() : show())}
        className={pickerButtonClass}
      >
        {locked ? <LockIcon /> : <CalendarIcon />}
      </button>
      <PickerProblem id={errId} problem={problem} />
      {anchor && (
        <PickerPopover anchor={anchor} popRef={pop} className="w-[min(22rem,calc(100vw-1rem))] p-3">
          <Calendar
            id={calId}
            selected={current}
            min={min}
            max={max}
            canType={tapToPick}
            onPick={(iso) => {
              commit(iso);
              close(touch ? "button" : "box");
            }}
            onClose={() => close("button")}
            onType={() => {
              close();
              flushSync(() => setTypeMode(true));
              input.current?.focus();
              input.current?.select();
            }}
          />
        </PickerPopover>
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
  canType,
  onPick,
  onClose,
  onType,
}: {
  id: string;
  selected: string;
  min?: string;
  max?: string;
  canType: boolean;
  onPick: (iso: string) => void;
  onClose: () => void;
  onType: () => void;
}) {
  const today = todayIso();
  const start = selected || (min && today < min ? min : max && today > max ? max : today);
  const [focusDay, setFocusDay] = useState(start);
  // Focus follows the day only when keys moved it (or on opening); the month buttons keep their focus.
  const moveFocus = useRef(true);
  const grid = useRef<HTMLDivElement>(null);
  const month = focusDay.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const blocked = (iso: string) => !!((min && iso < min) || (max && iso > max));

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay]);

  const move = (n: number, by: "day" | "month" = "day", focus = true) => {
    moveFocus.current = focus;
    setFocusDay(by === "day" ? addDays(focusDay, n) : addMonths(focusDay, n));
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
    };
    const act = map[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  };
  const arrow = "flex h-11 w-11 items-center justify-center rounded-full text-xl text-brand hover:bg-brand-soft dark:text-foreground";
  const link = "min-h-11 px-2 font-semibold underline-offset-4 hover:underline";

  return (
    <div
      id={id}
      role="dialog"
      aria-label={`Choose a date, ${title}`}
      onKeyDown={(e) => {
        // Esc closes the calendar from anywhere in it, and never the window behind.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        // Tab stays inside the calendar until it's closed (it sits at the end of the page's code).
        if (e.key === "Tab") {
          const stops = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")].filter((b) => b.tabIndex >= 0);
          const at = stops.indexOf(document.activeElement as HTMLButtonElement);
          if (e.shiftKey ? at <= 0 : at === stops.length - 1) {
            e.preventDefault();
            stops[e.shiftKey ? stops.length - 1 : 0]?.focus();
          }
        }
      }}
    >
      <div className="flex items-center justify-between">
        <button type="button" className={arrow} onClick={() => move(-1, "month", false)} aria-label="Previous month">
          ‹
        </button>
        <p className="font-semibold" aria-live="polite">
          {title}
        </p>
        <button type="button" className={arrow} onClick={() => move(1, "month", false)} aria-label="Next month">
          ›
        </button>
      </div>
      <div ref={grid} role="group" aria-label={title} onKeyDown={keys} className="mt-2 grid grid-cols-7 gap-1 text-center">
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
                aria-disabled={off || undefined}
                aria-current={day === today ? "date" : undefined}
                aria-label={`${longDay(day)}${day === today ? ", today" : ""}${on ? ", selected" : ""}${off ? ", not available" : ""}`}
                onClick={() => {
                  if (!off) onPick(day);
                }}
                className={`flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-sm tabular-nums ${
                  on
                    ? "bg-brand font-semibold text-brand-foreground"
                    : off
                      ? "cursor-not-allowed text-disabled line-through decoration-1"
                      : `font-medium hover:bg-brand-soft ${day === today ? "ring-1 ring-brand dark:ring-foreground" : ""}`
                }`}
              >
                {Number(day.slice(8))}
              </button>
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-2 border-t border-border pt-2 text-sm">
        <button
          type="button"
          onClick={() => {
            if (focusDay === today) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${today}"]`)?.focus();
            moveFocus.current = true;
            setFocusDay(today);
          }}
          className={`${link} text-brand dark:text-foreground`}
        >
          Today
        </button>
        {canType && (
          <button type="button" onClick={onType} className={`${link} text-brand dark:text-foreground`}>
            Type it instead
          </button>
        )}
        <button type="button" onClick={onClose} className={`${link} text-muted`}>
          Close
        </button>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 6h15v14h-15zM4.5 10.5h15M9 3.5v4M15 3.5v4" />
    </svg>
  );
}
