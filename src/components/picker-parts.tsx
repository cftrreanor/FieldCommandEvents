"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Shared pieces of DateField and TimeField (issue #347).

/** The visible box: a solid focus ring, red when it can't be used, tinted and dashed when it can't be changed. */
export const pickerBoxClass =
  "min-h-11 w-full rounded-sm border border-field-border bg-surface pl-3 pr-11 text-base transition placeholder:text-disabled focus:border-brand aria-invalid:border-2 aria-invalid:border-danger aria-disabled:cursor-not-allowed aria-disabled:border-dashed aria-disabled:bg-border/50 aria-disabled:text-disabled";

/** The icon button inside the right end of the box. Its focus ring sits inside the box. */
export const pickerButtonClass =
  "absolute top-px right-px flex h-[42px] w-[42px] items-center justify-center rounded-full text-brand hover:bg-brand-soft focus-visible:outline-offset-[-4px] disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent dark:text-foreground";

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
      el.style.maxHeight = "";
      const h = el.offsetHeight;
      // The part of the screen people can see: on a phone, above the on-screen keyboard.
      const vv = window.visualViewport;
      const seenTop = vv?.offsetTop ?? 0;
      const seenBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const below = seenBottom - r.bottom;
      const above = r.top - seenTop;
      const up = below < h + 8 && above > below;
      // A short screen (zoomed in, keyboard up, phone turned sideways): the pop-up scrolls inside itself.
      const room = (up ? above : below) - 12;
      if (h > room) el.style.maxHeight = `${Math.max(132, room)}px`;
      el.style.top = `${up ? Math.max(seenTop + 8, r.top - Math.min(h, room) - 4) : r.bottom + 4}px`;
      el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    // The keyboard coming up or going away.
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor, popRef, matchWidth]);

  const host = anchor.closest("dialog") ?? document.body;
  return createPortal(
    <div
      ref={popRef}
      className={`fixed z-[60] overflow-y-auto overscroll-contain rounded-lg border border-field-border bg-raised text-foreground shadow-elevated ${className}`}
      style={{ top: -9999, left: -9999 }}
    >
      {children}
    </div>,
    host,
  );
}

/**
 * Before a pop-up opens under a box low on the screen, scroll the box up so it fits below (instead of opening
 * upward over the box's own label). Pinned bars at the bottom count as no room.
 */
export function makeRoom(box: HTMLElement, need: number) {
  const r = box.getBoundingClientRect();
  const h = window.innerHeight;
  const bars = [...document.querySelectorAll<HTMLElement>('[class*="bottom-"]')].filter((b) => {
    const pos = getComputedStyle(b).position;
    const br = b.getBoundingClientRect();
    return (pos === "fixed" || pos === "sticky") && br.height > 0 && br.bottom >= h - 2 && br.top > h / 2;
  });
  const pinned = Math.max(0, ...bars.map((b) => h - b.getBoundingClientRect().top));
  if (h - pinned - r.bottom >= need) return;
  box.scrollIntoView({ block: "start", behavior: "instant" });
}

export function LockIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}
