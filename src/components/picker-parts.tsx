"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Shared pieces of DateField and TimeField (issue #347).

/** The visible box: a solid focus ring, red when it can't be used, tinted and dashed when it can't be changed. */
export const pickerBoxClass =
  "min-h-11 w-full rounded-sm border border-field-border bg-surface pl-3 pr-11 text-base transition placeholder:text-muted focus:border-brand aria-invalid:border-2 aria-invalid:border-danger aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:bg-border/50 aria-disabled:text-muted";

/** The icon button inside the right end of the box. Its focus ring sits inside the box. */
export const pickerButtonClass =
  "absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-r-sm text-brand hover:bg-brand-soft focus-visible:outline-offset-[-4px] disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent dark:text-foreground";

/** The error under the box: always there, so screen readers hear it as soon as it appears. */
export function PickerProblem({ id, problem }: { id: string; problem: string | null }) {
  return (
    <span id={id} aria-live="polite" className={problem ? "mt-1 block text-sm font-semibold text-danger" : "sr-only"}>
      {problem}
    </span>
  );
}

/**
 * Forms notice edits from "input" and "change" events (autosave, unsaved-changes warnings, required boxes).
 * Picking from the calendar or the list doesn't type anything, so once the new value is on the page this sends
 * those events from the box, as the browser's picker did.
 */
export function useEditEvents(wrap: RefObject<HTMLElement | null>, current: string) {
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    wrap.current?.dispatchEvent(new Event("input", { bubbles: true }));
    wrap.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [wrap, current]);
  return () => {
    pending.current = true;
  };
}

const coarse = "(pointer: coarse)";
function subscribe(change: () => void) {
  const q = window.matchMedia(coarse);
  q.addEventListener("change", change);
  return () => q.removeEventListener("change", change);
}
/** True on touch screens: a tap opens the calendar or the time list instead of the keyboard. */
export function useTouchScreen() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(coarse).matches,
    () => false,
  );
}

/**
 * Inside a <Field> (a <label>), the box is named by the label's words only, and the icon button by a short
 * action plus the label ("Pick a date for First day"), instead of everything inside the label run together.
 */
export function useFieldLabel(
  input: RefObject<HTMLInputElement | null>,
  button: RefObject<HTMLButtonElement | null> | null,
  boxId: string,
  actionId: string,
  hasOwnLabel: boolean,
) {
  useEffect(() => {
    const el = input.current;
    const span = el?.closest("label")?.querySelector<HTMLElement>("[data-field-label]");
    if (!el || !span || hasOwnLabel) return;
    if (!span.id) span.id = `${boxId}-label`;
    el.setAttribute("aria-labelledby", span.id);
    button?.current?.setAttribute("aria-labelledby", `${actionId} ${span.id}`);
  }, [input, button, boxId, actionId, hasOwnLabel]);
}

/**
 * A pop-up (the calendar or the time list) floating above the page, under its box, or above it when there's no
 * room below. It's placed outside the box's label and form layout, so it's never cut off by a window's scrolling
 * area, and inside an open <dialog> (so it shows above it).
 */
export function PickerPopover({
  anchor,
  popRef,
  matchWidth,
  children,
  className = "",
}: {
  anchor: HTMLElement;
  popRef: RefObject<HTMLDivElement | null>;
  matchWidth?: boolean;
  children: ReactNode;
  className?: string;
}) {
  useLayoutEffect(() => {
    const place = () => {
      const el = popRef.current;
      if (!el) return;
      const box = anchor.querySelector("input:not([type=hidden])") ?? anchor;
      const r = box.getBoundingClientRect();
      if (matchWidth) el.style.minWidth = `${r.width}px`;
      const h = el.offsetHeight;
      const below = window.innerHeight - r.bottom;
      const up = below < h + 8 && r.top > below;
      el.style.top = `${up ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, popRef, matchWidth]);

  const host = anchor.closest("dialog") ?? document.body;
  return createPortal(
    <div
      ref={popRef}
      className={`fixed z-[60] rounded-lg border border-field-border bg-raised text-foreground shadow-elevated ${className}`}
      style={{ top: -9999, left: -9999 }}
    >
      {children}
    </div>,
    host,
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}
