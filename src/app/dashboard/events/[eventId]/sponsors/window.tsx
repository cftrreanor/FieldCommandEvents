"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui";

/**
 * One window style for every Sponsors window (light check): the question or name as its title, the way out an
 * outline button, the action filled (red only for Remove). Shown while mounted; Escape and a click outside are the
 * way out too. The body scrolls inside the window on short screens; the buttons stay at its foot.
 */
export function Window({
  title,
  children,
  actions,
  onClose,
  wide = false,
  row = false,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  wide?: boolean;
  /** The buttons side by side on phones too (each half the width), instead of stacked. */
  row?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const d = ref.current;
    const h = heading.current;
    // Where focus goes back to when the window closes (the button that opened it, if it's still there).
    const back = document.activeElement;
    if (d && !d.open) d.showModal();
    // Start on the title, so screen readers hear it and keyboards start inside the window.
    h?.focus();
    return () => {
      if (d?.open) d.close();
      if (back instanceof HTMLElement && back !== h && document.contains(back)) back.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => e.target === e.currentTarget && close.current()}
      className={`team-window m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col rounded-xl border border-border p-0 text-left text-foreground shadow-elevated open:flex ${wide ? "max-w-xl" : "max-w-lg"}`}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
        <h2 id={id} ref={heading} tabIndex={-1} className="text-lg leading-7 font-semibold outline-none [overflow-wrap:anywhere]">
          {title}
        </h2>
        <div className="mt-3 space-y-4 text-sm leading-6">{children}</div>
      </div>
      <div
        className={`flex gap-3 border-t border-border px-5 py-4 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6 ${row ? "flex-row max-sm:[&>button]:flex-1" : "flex-col-reverse"}`}
      >
        {actions}
      </div>
    </dialog>
  );
}

/** A question before a step that takes something away: an outline way out naming what's kept, a red action. */
export function ConfirmWindow({
  title,
  children,
  keepLabel,
  actionLabel,
  onKeep,
  onConfirm,
  disabled = false,
  disabledReason,
}: {
  title: string;
  children: ReactNode;
  keepLabel: string;
  actionLabel: string;
  onKeep: () => void;
  onConfirm: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Window
      title={title}
      onClose={onKeep}
      actions={
        <>
          {disabled && disabledReason && <p className="self-center text-sm text-muted sm:mr-auto">{disabledReason}</p>}
          <Button type="button" variant="secondary" onClick={onKeep}>
            {keepLabel}
          </Button>
          <Button type="button" variant="warn" onClick={onConfirm} disabled={disabled}>
            {actionLabel}
          </Button>
        </>
      }
    >
      {children}
    </Window>
  );
}
