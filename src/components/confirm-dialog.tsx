"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { Share } from "@/lib/action-state";

// Our own windows in place of the browser's confirm(), prompt() and "copy
// this" boxes, which look different in every browser and can't be styled.
// Call confirmDialog() (or askDialog() / copyDialog()) from anywhere in the
// browser; the one <DialogHost /> in the root layout shows it.

export type ConfirmOptions = {
  /** The question, as a short heading ("Delete this banner?"). */
  title: string;
  /** What happens, in a sentence or two. */
  message?: string;
  /** The action button's words ("Delete banner"). */
  confirmLabel?: string;
  /** The way out ("Keep it"). */
  cancelLabel?: string;
  /** Red action button, for deleting and other things that can't be undone. */
  danger?: boolean;
};

type AskField = { name: string; label: string; defaultValue?: string; placeholder?: string; type?: "text" | "url" };

type Request = { id: number } & (
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmOptions)
  | { kind: "ask"; title: string; fields: AskField[]; confirmLabel?: string; resolve: (values: Record<string, string> | null) => void }
  | { kind: "copy"; title: string; text: string; resolve: () => void }
  | ({ kind: "share"; resolve: () => void } & Share)
);
type NewRequest = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

let current: Request | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const show = (r: NewRequest | null) => {
  current = r ? ({ ...r, id: nextId++ } as Request) : null;
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Splits an old one-line confirm ("Cancel the meeting? We'll email them.")
 * into the question (the title) and what happens (the message).
 */
export function confirmFromText(text: string, extra?: Partial<ConfirmOptions>): ConfirmOptions {
  const m = /^([^?]+\?)\s+([\s\S]+)$/.exec(text.trim());
  const danger = /\b(delete|remove|can't be undone|cannot be undone|permanently|cancel|discard|close the account|suspend|close [a-z ]*(registration|sign-up))\b/i.test(text);
  return { title: m ? m[1] : text.trim(), message: m ? m[2] : undefined, danger, ...extra };
}

/** Ask before doing something. Resolves true when they press the action button. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => show({ kind: "confirm", ...options, resolve }));
}

/** Ask for a value or two (a link and its text). Resolves null when they back out. */
export function askDialog(title: string, fields: AskField[], confirmLabel?: string): Promise<Record<string, string> | null> {
  return new Promise((resolve) => show({ kind: "ask", title, fields, confirmLabel, resolve }));
}

/** When copying to the clipboard isn't allowed: show the text, ready to select and copy. */
export function copyDialog(title: string, text: string): Promise<void> {
  return new Promise((resolve) => show({ kind: "copy", title, text, resolve }));
}

/** Something just went public: its link, ready to copy, open, or share as a QR code. */
export function shareDialog(share: Share): Promise<void> {
  return new Promise((resolve) => show({ kind: "share", ...share, resolve }));
}

/** Shows the window asked for, once per page (in the root layout). */
export function DialogHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    if (!request && el.open) el.close();
  }, [request]);

  // Every way out (Escape, a click outside, the back-out button) answers "no".
  const close = () => {
    const r = current;
    if (!r) return;
    show(null);
    if (r.kind === "confirm") r.resolve(false);
    else if (r.kind === "ask") r.resolve(null);
    else r.resolve();
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="app-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="team-window m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-border p-0 text-foreground shadow-elevated"
    >
      {request && <DialogBody key={request.id} request={request} close={close} />}
    </dialog>
  );
}

function DialogBody({ request: r, close }: { request: Request; close: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <form
      method="dialog"
      className="p-6"
      onSubmit={(e) => {
        e.preventDefault();
        show(null);
        if (r.kind === "confirm") r.resolve(true);
        else if (r.kind === "ask") r.resolve(Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, String(v)])));
        else r.resolve();
      }}
    >
      <h2 id="app-dialog-title" className="text-xl font-semibold">
        {r.title}
      </h2>
      {r.kind === "confirm" && r.message && <p className="mt-3 leading-7 text-muted">{r.message}</p>}
      {r.kind === "ask" && (
        <div className="mt-4 space-y-3">
          {r.fields.map((f, i) => (
            <Field key={f.name} label={f.label}>
              <Input name={f.name} type={f.type ?? "text"} defaultValue={f.defaultValue} placeholder={f.placeholder} autoFocus={i === 0} required />
            </Field>
          ))}
        </div>
      )}
      {r.kind === "share" && (
        <div className="mt-3 space-y-4">
          {r.note && <p className="leading-7 text-muted">{r.note}</p>}
          <input
            readOnly
            value={r.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link to share"
            className="min-h-11 w-full rounded-sm border border-field-border bg-background px-3 text-sm"
          />
          {r.qr && (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made on the server */}
              <img src={r.qr} alt="QR code for the link" width={96} height={96} className="shrink-0 rounded-md border border-border bg-white p-1" />
              <p className="text-sm leading-6 text-muted">
                For flyers, slides, and signs.{" "}
                <a href={r.qr} download={r.qrName ?? "qr-code.png"} className="font-medium text-brand underline-offset-4 hover:underline">
                  Download QR code
                </a>
              </p>
            </div>
          )}
        </div>
      )}
      {r.kind === "copy" && (
        <textarea
          readOnly
          value={r.text}
          rows={Math.min(6, Math.max(2, Math.ceil(r.text.length / 45)))}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          aria-label={r.title}
          className="mt-4 w-full rounded-sm border border-field-border bg-background px-3 py-2 text-sm"
        />
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {r.kind === "share" ? (
          <>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold text-muted hover:text-foreground"
            >
              Open page ↗
            </a>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(r.url);
                  setCopied(true);
                } catch {
                  // Blocked: the link above is ready to select and copy by hand.
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="submit">Done</Button>
          </>
        ) : r.kind === "copy" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(r.text);
                  setCopied(true);
                } catch {
                  // Still blocked: the text is selected, ready to copy by hand.
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="submit">Done</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={close}>
              {(r.kind === "confirm" && r.cancelLabel) || "Never mind"}
            </Button>
            <Button type="submit" variant={r.kind === "confirm" && r.danger ? "warn" : undefined}>
              {r.confirmLabel || (r.kind === "ask" ? "Add" : "Continue")}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
