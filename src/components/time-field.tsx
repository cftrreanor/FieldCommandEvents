"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatTime, parseTime, timesEvery } from "@/lib/date-input";

const fieldClass =
  "min-h-11 w-full rounded-sm border border-field-border bg-surface pl-3 pr-11 text-base outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand/25 aria-invalid:border-danger disabled:cursor-not-allowed disabled:bg-background disabled:text-disabled";

type ChangeEvent = { target: { value: string; name?: string } };

/**
 * A time box in our own style (issue #347), in place of the browser's time picker: type a time ("3:30 pm",
 * "330p", "15:30") or pick one from the list under it (every 15 minutes, or `step` minutes). It reads as
 * "3:30 PM". The form gets the browser picker's value ("15:30") from a hidden input with `name`, so it drops
 * in where `<Input type="time">` was. Controlled (`value`, `onChange` with `{ target: { value } }`) or not.
 */
export function TimeField({
  name,
  value,
  defaultValue = "",
  onChange,
  step = 15,
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
  /** Minutes between the times in the list. */
  step?: number;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue);
  const current = (controlled ? value : own).slice(0, 5);
  // What's typed, while typing; otherwise the value as "3:30 PM".
  const [typed, setTyped] = useState<string | null>(null);
  const typing = typed !== null;
  const text = typed ?? formatTime(current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const autoId = useId();
  const boxId = id ?? `time-${autoId}`;
  const listId = `${boxId}-list`;
  const errId = `${boxId}-problem`;

  const all = useMemo(() => timesEvery(step), [step]);
  // While typing, the list narrows to times that start the same way ("3" shows 3:00 AM to 3:45 PM).
  const shown = useMemo(() => {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!typing || !t) return all;
    const matches = all.filter((v) => formatTime(v).toLowerCase().startsWith(t) || formatTime(v).toLowerCase().replace(":00", "").startsWith(t));
    return matches.length ? matches : all;
  }, [all, text, typing]);

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

  useEffect(() => {
    input.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  // Opening the list highlights the time already chosen, or 8:00 AM.
  const openList = () => {
    if (open) return;
    const from = current || "08:00";
    const at = all.findIndex((v) => v >= from);
    setActive(at < 0 ? 0 : at);
    setOpen(true);
  };
  // Arrow keys mean choosing from the list, so Enter takes the highlighted time.
  const [arrowed, setArrowed] = useState(false);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const commit = (v: string) => {
    if (!controlled) setOwn(v);
    onChange?.({ target: { value: v, name } });
    setTyped(null);
    setArrowed(false);
    setProblem(null);
  };
  const readTyped = () => {
    if (typed === null) return;
    const t = typed.trim();
    if (!t) {
      if (current) commit("");
      return;
    }
    const v = parseTime(t);
    if (!v) return setProblem("Enter a time like 3:30 PM, or pick one from the list.");
    commit(v);
  };

  return (
    <div className={`relative ${className}`}>
      <input
        ref={input}
        id={boxId}
        type="text"
        role="combobox"
        autoComplete="off"
        value={text}
        required={required}
        disabled={disabled}
        placeholder="--:-- --"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={problem ? true : undefined}
        aria-describedby={[describedBy, problem ? errId : null].filter(Boolean).join(" ") || undefined}
        onChange={(e) => {
          setTyped(e.target.value);
          setArrowed(false);
          setOpen(true);
          setActive(0);
          if (problem) setProblem(null);
        }}
        onClick={openList}
        onBlur={() => {
          setOpen(false);
          readTyped();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else setActive((a) => Math.min(shown.length - 1, a + 1));
            setArrowed(true);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
            setArrowed(true);
          } else if (e.key === "Enter") {
            // The highlighted time when arrowing through the list; otherwise what was typed ("3:20 pm" needn't be listed).
            e.preventDefault();
            if (open && arrowed && active >= 0) commit(shown[active]);
            else readTyped();
            setOpen(false);
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              setOpen(false);
            }
          }
        }}
        className={fieldClass}
      />
      {name && <input type="hidden" name={name} value={current} />}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-hidden
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) setOpen(false);
          else openList();
          input.current?.focus();
        }}
        className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center text-brand disabled:text-disabled dark:text-foreground"
      >
        <ClockIcon />
      </button>
      {problem && (
        <p id={errId} className="mt-1 text-sm font-semibold text-danger">
          {problem}
        </p>
      )}
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Times"
          className="absolute left-0 z-40 mt-1 max-h-64 w-full min-w-40 overflow-y-auto rounded-lg border border-field-border bg-surface p-1 shadow-elevated"
        >
          {shown.map((v, i) => (
            <li
              key={v}
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={v === current}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                commit(v);
                setOpen(false);
              }}
              className={`flex min-h-11 cursor-pointer items-center justify-between rounded-md px-3 text-sm tabular-nums ${
                i === active ? "bg-brand-soft" : ""
              } ${v === current ? "font-semibold" : ""}`}
            >
              {formatTime(v)}
              {v === current && <span aria-hidden>✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
    </svg>
  );
}
