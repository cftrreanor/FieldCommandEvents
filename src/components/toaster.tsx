"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Success messages ("Saved.", "Added Hair Tinsel.") appear as a small toast
// in the top-right corner of the page instead of inside the form. Each one
// closes on its own after 30 seconds, or with its × button. Errors stay next
// to the form they belong to (see FormMessage).

type Toast = { id: number; message: string };

const SHOW_FOR_MS = 30_000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

/** Show a success toast. */
export function toast(message: string) {
  // The same message twice in a row (e.g. "Saved." again) restarts its toast.
  toasts = [...toasts.filter((t) => t.message !== message), { id: nextId++, message }].slice(-4);
  emit();
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const EMPTY: Toast[] = [];

/** The toast stack, once per page (in the root layout). */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 top-20 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
    >
      {list.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast: t }: { toast: Toast }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), SHOW_FOR_MS - 400);
    const gone = setTimeout(() => dismiss(t.id), SHOW_FOR_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [t.id]);
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-success/30 bg-surface px-4 py-3 shadow-elevated transition-opacity duration-300 ${
        leaving ? "opacity-0" : "opacity-100"
      }`}
    >
      <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success text-xs font-bold text-success-foreground">
        ✓
      </span>
      <p className="min-w-0 flex-1 text-sm leading-6">{t.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="-mt-1 -mr-2 grid size-8 shrink-0 place-items-center rounded-md text-lg leading-none text-muted hover:bg-background hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}

/** Raises a toast whenever `message` changes (for components that show one success message). */
export function SuccessToast({ message }: { message: string }) {
  useEffect(() => {
    toast(message);
  }, [message]);
  return null;
}
