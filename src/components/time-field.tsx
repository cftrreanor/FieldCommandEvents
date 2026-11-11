"use client";

import { useEffect, useId, useMemo, useRef, useState, type FocusEvent } from "react";
import { flushSync } from "react-dom";
import { formatTime, parseTime, timesEvery } from "@/lib/date-input";
import { LockIcon, PickerPopover, PickerProblem, pickerBoxClass, pickerButtonClass, makeRoom, useEditEvents, useFieldLabel, useTouchScreen } from "./picker-parts";

type ChangeEvent = { target: { value: string; name?: string } };

/**
 * A time box in our own style (issue #347), in place of the browser's time picker: type any time ("3:20 pm",
 * "330p", "15:30") or pick one from the list under it (every 15 minutes, or `step` minutes). While typing, the
 * time that will be saved is first in the list and highlighted. It reads as "3:30 PM". The form gets the
 * browser picker's value ("15:30") from a hidden input with `name`, so it drops in where the browser's time box
 * was. Controlled (`value`, `onChange` with `{ target: { value } }`) or not.
 *
 * An end time passes its start as `after`: a bare "7" then means the first 7 after the start. With
 * `requireAfter`, an end that isn't after the start is shown in red and stops the form saving (leave it off
 * where an end can run past midnight).
 */
export function TimeField({
  name,
  value,
  defaultValue = "",
  onChange,
  onBlur,
  step = 15,
  after,
  requireAfter,
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
  /** Minutes between the times in the list. */
  step?: number;
  /** For an end time: its start ("15:30"). The end must be after it. */
  after?: string;
  /** The end must be after `after` (no running past midnight). */
  requireAfter?: boolean;
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
  const [seenDefault, setSeenDefault] = useState(defaultValue);
  if (!controlled && defaultValue !== seenDefault) {
    setSeenDefault(defaultValue);
    setOwn(defaultValue);
  }
  const current = (controlled ? value : own).slice(0, 5);
  // What's typed, while typing; otherwise the value as "3:30 PM".
  const [typed, setTyped] = useState<string | null>(null);
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  const [seenValue, setSeenValue] = useState(value);
  if (controlled && value !== seenValue) {
    setSeenValue(value);
    setTyped(null);
    setTypedProblem(null);
  }
  const typing = typed !== null;
  const text = typed ?? formatTime(current);
  const start = after?.slice(0, 5) || undefined;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const [active, setActive] = useState(-1);
  const touch = useTouchScreen();
  const [typeMode, setTypeMode] = useState(false);
  const locked = !!(disabled || readOnly);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const edited = useEditEvents(wrap, current);
  const autoId = useId();
  const boxId = id ?? `time-${autoId}`;
  const listId = `${boxId}-list`;
  const errId = `${boxId}-problem`;
  useFieldLabel(input, null, boxId, "", !!ariaLabel);

  const problem = typedProblem ?? (requireAfter && current && start && current <= start && !locked ? `Pick a time after ${formatTime(start)}.` : null);

  const all = useMemo(() => timesEvery(step), [step]);
  // While typing: the time that will be saved first ("4" after a 3:30 PM start is 4:00 PM), then the listed
  // times that start the same way, later ones first.
  const guess = typed !== null ? parseTime(typed, start) : null;
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!typing || !t) return all;
    const matches = all.filter((v) => formatTime(v).toLowerCase().startsWith(t) || formatTime(v).toLowerCase().replace(":00", "").startsWith(t));
    const base = matches.length ? matches : all;
    if (!guess) return base;
    return [guess, ...base.filter((v) => v > guess), ...base.filter((v) => v < guess)];
  }, [all, text, typing, guess]);

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

  useEffect(() => {
    input.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  // Opening the list puts the chosen time (or the first after the start, or 8:00 AM) near the top, with the
  // times after it in view.
  const openList = () => {
    if (open || locked || !wrap.current) return;
    makeRoom(wrap.current, 320);
    const from = current || (start ? all.find((v) => v > start) : undefined) || "08:00";
    const at = all.findIndex((v) => v >= from);
    setActive(at < 0 ? 0 : at);
    setAnchor(wrap.current);
  };

  // Keep the highlighted time in view inside the list, without moving the page.
  useEffect(() => {
    const ul = list.current;
    const item = ul?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!ul || !item) return;
    if (item.offsetTop < ul.scrollTop) ul.scrollTop = item.offsetTop - 4;
    else if (item.offsetTop + item.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = item.offsetTop + item.offsetHeight - ul.clientHeight + 4;
  }, [active]);
  useEffect(() => {
    const ul = list.current;
    const item = ul?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (open && ul && item && !typing) ul.scrollTop = Math.max(0, item.offsetTop - item.offsetHeight - 4);
    // Only when the list opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = (v: string) => {
    if (current !== v) edited();
    if (!controlled) setOwn(v);
    onChange?.({ target: { value: v, name } });
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
    const v = parseTime(t, start);
    if (!v) return setTypedProblem("Enter a time like 3:30 PM, or pick one from the list.");
    commit(v);
  };

  const tapToPick = touch && !typeMode;

  return (
    <div ref={wrap} data-picker data-picker-open={open || undefined} className={`relative scroll-mt-24 ${className}`}>
      <input
        ref={input}
        id={boxId}
        type="text"
        role="combobox"
        inputMode={tapToPick ? "none" : "text"}
        autoComplete="off"
        data-picker-box
        value={text}
        required={required}
        readOnly={locked}
        autoFocus={autoFocus}
        placeholder="Pick a time"
        aria-label={ariaLabel}
        aria-disabled={locked || undefined}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={problem || ariaInvalid === true || ariaInvalid === "true" ? true : undefined}
        aria-describedby={[describedBy, problem ? errId : null].filter(Boolean).join(" ") || undefined}
        onChange={(e) => {
          const next = e.target.value;
          setTyped(next);
          if (!open && wrap.current) setAnchor(wrap.current);
          // The first row is highlighted only when it's what will be saved.
          setActive(parseTime(next, start) ? 0 : -1);
          if (typedProblem) setTypedProblem(null);
        }}
        onClick={openList}
        onBlur={(e) => {
          setAnchor(null);
          readTyped();
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            // The highlighted time, which while typing is always the typed time read as a time.
            e.preventDefault();
            if (open && active >= 0 && shown[active]) commit(shown[active]);
            else readTyped();
            setAnchor(null);
          } else if (e.key === "Escape") {
            // Close the list first; then put back the saved time. Never close the window behind.
            if (open) setAnchor(null);
            else if (typing) {
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
      <button
        type="button"
        tabIndex={-1}
        disabled={locked}
        aria-hidden
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) setAnchor(null);
          else openList();
          input.current?.focus();
        }}
        className={pickerButtonClass}
      >
        {locked ? <LockIcon /> : <ClockIcon />}
      </button>
      <PickerProblem id={errId} problem={problem} />
      {anchor && (
        <PickerPopover anchor={anchor} popRef={pop} matchWidth className="w-max min-w-40">
          <ul ref={list} id={listId} role="listbox" aria-label="Times" className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {shown.map((v, i) => (
              <li
                key={v}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                aria-label={`${formatTime(v)}${v === current ? ", chosen" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  commit(v);
                  setAnchor(null);
                }}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-md px-3 text-sm tabular-nums ${
                  i === active ? "bg-brand-soft shadow-[inset_4px_0_0_var(--focus)]" : "hover:bg-brand-soft/60"
                } ${v === current ? "font-semibold" : ""}`}
              >
                {formatTime(v)}
                {v === current && <span aria-hidden>✓</span>}
              </li>
            ))}
          </ul>
          {tapToPick && (
            <div className="border-t border-border p-1">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setAnchor(null);
                  flushSync(() => setTypeMode(true));
                  input.current?.blur();
                  input.current?.focus();
                  input.current?.select();
                }}
                className="min-h-11 w-full rounded-md px-3 text-left text-sm font-semibold text-brand hover:bg-brand-soft dark:text-foreground"
              >
                Type it instead
              </button>
            </div>
          )}
        </PickerPopover>
      )}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
    </svg>
  );
}
