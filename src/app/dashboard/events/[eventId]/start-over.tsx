"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { discardCopy } from "@/app/dashboard/duplicate-actions";
import { confirmDialog } from "@/components/confirm-dialog";
import { toast } from "@/components/toaster";

/**
 * "Delete and start over" on a duplicated draft: a quiet red link after the "Copied from" note, for the person who
 * made the copy while it's never been published and nothing is on it (the database checks again). The window says
 * what goes, including any invitation already emailed, then it's back to Duplicate event with the name and first
 * day kept.
 */
export function StartOverButton({ eventId, name, bullets }: { eventId: string; name: string; bullets: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = async () => {
    if (pending) return;
    const ok = await confirmDialog({
      title: `Delete ${name} and start over?`,
      bullets,
      confirmLabel: "Delete this copy",
      // Short, so it never wraps (a long event name made it two lines).
      cancelLabel: "Keep this copy",
      danger: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await discardCopy(eventId);
      if (r.error) {
        toast(r.error);
        return;
      }
      if (r.message) toast(r.message);
      if (r.goTo) router.push(r.goTo);
    });
  };
  return (
    <button
      type="button"
      onClick={go}
      aria-disabled={pending || undefined}
      className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-danger underline underline-offset-4 aria-disabled:cursor-wait"
    >
      {pending ? "Deleting…" : "Delete and start over"}
    </button>
  );
}
