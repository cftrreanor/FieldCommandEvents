"use client";

import { useEffect, useId, useRef, useState } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { CopyLink } from "@/components/copy-link";
import { setPending, useLeaveGuard } from "@/components/pending-edits";
import { toast } from "@/components/toaster";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { saveOrgPageDetail, turnOffOrgPage } from "../org-page-actions";

const BTN = "inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
const BTN_OUTLINE = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** The page is on: its link, Copy link and Preview, and the group name and contact email, saving as you go. */
export function StatusCard({ orgId, url, name, contact }: { orgId: string; url: string; name: string; contact: string }) {
  useLeaveGuard("The organization page's details");
  return (
    <Card>
      <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
        <Badge tone="live">On</Badge>
        <span>Anyone with the link can open it</span>
      </h2>
      <p className="mt-1 text-sm text-muted">We ask search engines not to list it. Nobody is emailed about it.</p>
      <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm [overflow-wrap:anywhere]">{url}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <CopyLink url={url} className={BTN} ariaLabel="Copy your organization page's link" />
        <a href={url} target="_blank" rel="noreferrer" className={BTN_OUTLINE}>
          Preview page<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <div className="mt-5 space-y-5 border-t border-border pt-4">
        <AutoField
          orgId={orgId}
          field="name"
          label="Group name"
          hint="The heading of your page. Its web address stays the same."
          initial={name}
          maxLength={120}
        />
        <AutoField
          orgId={orgId}
          field="contact"
          label="Contact email"
          hint="Shown at the bottom of your page, and when nothing's coming up. Use a group address if you have one, like hello@yourgroup.org."
          initial={contact}
          type="email"
          maxLength={254}
        />
      </div>
    </Card>
  );
}

type Status = { kind: "idle" | "waiting" | "saving" | "saved" } | { kind: "failed"; error: string; retry: boolean };

/** One box that saves itself a moment after typing stops, with its status on the line under it. */
function AutoField({
  orgId,
  field,
  label,
  hint,
  initial,
  type = "text",
  maxLength,
}: {
  orgId: string;
  field: "name" | "contact";
  label: string;
  hint: string;
  initial: string;
  type?: string;
  maxLength: number;
}) {
  const key = useId();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);
  const saved = useRef(initial);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      setPending(key, null);
    },
    [key],
  );

  const save = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    if (v.trim() === saved.current.trim()) {
      setStatus((s) => (s.kind === "waiting" ? { kind: "idle" } : s));
      setPending(key, null);
      return;
    }
    setStatus({ kind: "saving" });
    setPending(key, { kind: "saving" });
    try {
      const res = await saveOrgPageDetail(orgId, field, v);
      if (latest.current !== v) return; // a newer change is on its way
      if (res.error) {
        setStatus({ kind: "failed", error: res.error, retry: false });
        setPending(key, { kind: "failed" });
      } else {
        saved.current = v;
        setStatus({ kind: "saved" });
        setPending(key, null);
      }
    } catch {
      setStatus({ kind: "failed", error: "Check your connection, then select Retry.", retry: true });
      setPending(key, { kind: "failed", flush: () => void save() });
    }
  };

  const failed = status.kind === "failed";
  const id = `org-${field}`;
  return (
    <div>
      <Field label={label} hint={hint}>
        <Input
          id={id}
          type={type}
          value={value}
          maxLength={maxLength}
          onChange={(e) => {
            setValue(e.target.value);
            latest.current = e.target.value;
            setStatus({ kind: "waiting" });
            // Waiting to save: leaving the page saves it first.
            setPending(key, { kind: "saving", flush: () => void save() });
            if (timer.current) clearTimeout(timer.current);
            // Checked when they stop typing, not while they type (lesson L3).
            timer.current = setTimeout(() => void save(), 1500);
          }}
          onBlur={() => status.kind === "waiting" && void save()}
          aria-invalid={failed || undefined}
          aria-describedby={`${id}-status`}
          className={failed ? "!border-danger" : ""}
        />
      </Field>
      <div id={`${id}-status`} role="status" className="mt-1.5 min-h-6 text-sm">
        {status.kind === "saving" || status.kind === "waiting" ? (
          <p className="text-muted">Saving…</p>
        ) : status.kind === "saved" ? (
          <p className="font-medium">
            <span aria-hidden className="text-success">
              ✓{" "}
            </span>
            Saved
          </p>
        ) : failed ? (
          <p className="flex flex-wrap items-center gap-x-2 font-semibold text-danger">
            <span>
              <span aria-hidden>▲ </span>
              {label}: not saved. {status.error}
            </span>
            {status.retry && (
              <button type="button" onClick={() => void save()} className="inline-flex min-h-11 items-center rounded-md border-[1.5px] border-danger px-3">
                Retry
              </button>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Turn off: asks first, then says what changed. */
export function TurnOff({ orgId }: { orgId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <h2 className="text-lg font-semibold">Turn off your organization page</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        The page says it isn&apos;t available, and sign-up pages stop showing your other events. Your choices are kept.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          const ok = await confirmDialog({
            title: "Turn off your organization page?",
            bullets: [
              "Anyone who opens the link sees “This page isn’t available”",
              "Sign-up pages stop showing your other events",
              "Your events, their links, and everyone’s sign-ups don’t change. Nobody is emailed",
              "Your choices and ways to help are kept, so you can turn it on again with the same link",
            ],
            confirmLabel: "Turn off page",
            cancelLabel: "Keep it on",
            danger: true,
          });
          if (!ok) return;
          setBusy(true);
          setError(null);
          try {
            const res = await turnOffOrgPage(orgId);
            if (res.error) setError(res.error);
            else toast("Your organization page is off. Anyone who opens its link sees that it isn't available.");
          } catch {
            setError("Couldn't turn it off. Check your connection, then try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Turning off…" : "Turn off page"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          Still on. {error}
        </p>
      )}
    </Card>
  );
}
