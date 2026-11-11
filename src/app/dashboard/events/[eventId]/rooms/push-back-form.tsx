"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { NumberInput } from "@/components/number-input";
import { Button, Select } from "@/components/ui";
import { directorsOf } from "@/lib/rooms";
import { pushBack } from "./actions";
import { Choice, Window } from "./windows";

/** A group on the schedule, for "Starting with". */
export type PushGroup = { id: string; name: string; day: string; dayLabel: string; startsAt: string; startLabel: string };

/**
 * "Push the schedule back" (board 14's window): the chosen group and every group after it that day move later,
 * with the email choice. Hosts and co-hosts only (the database checks). Exported for Event day too: give it every
 * group with times, in order, and the version the page loaded (null skips the check).
 */
export function PushBackButton({
  eventId,
  groups,
  defaultGroup,
  posted,
  version,
  multiDay,
  onDone,
  className,
  label = "Push the schedule back",
}: {
  eventId: string;
  /** Every group with times, in order (each day's groups together). */
  groups: PushGroup[];
  /** The first group that hasn't started yet. */
  defaultGroup?: string;
  posted: boolean;
  version: number | null;
  multiDay: boolean;
  /** After a push back (the page reloads its schedule); without it, the page refreshes. */
  onDone?: () => void;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultGroup ?? groups[0]?.id ?? "");
  const [minutes, setMinutes] = useState("10");
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!groups.length) return null;

  const first = groups.find((g) => g.id === from) ?? groups[0];
  const sameDay = groups.filter((g) => g.day === first.day);
  const after = sameDay.length - sameDay.findIndex((g) => g.id === first.id) - 1;
  const count = after + 1;
  const m = Number(minutes);
  const valid = Number.isInteger(m) && m >= 1 && m <= 240;
  const button = !posted ? "Push back" : email ? `Push back and email ${directorsOf(count)}` : "Push back without emailing";

  const submit = async () => {
    if (!valid) return setError("Enter 1 to 240 minutes.");
    setBusy(true);
    setError(null);
    const r = await pushBack(eventId, { bandId: first.id, minutes: m, email: posted && email, expectedVersion: version }).catch(() => ({
      error: "Check your connection, then try again.",
    }));
    setBusy(false);
    if ("conflict" in r) {
      const c = r.conflict.changes[0];
      setError(`${c.name} changed the schedule${c.at ? ` at ${c.at}` : ""}${c.summary ? `: ${c.summary.replace(/\.$/, "")}` : ""}. The times are up to date now. Push back again if you still need to.`);
      if (onDone) onDone();
      else router.refresh();
      return;
    }
    if ("error" in r) return setError(r.error);
    if ("ok" in r) {
      setOpen(false);
      if (onDone) onDone();
      else router.refresh();
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Window
        open={open}
        title="Push the schedule back"
        onClose={() => !busy && setOpen(false)}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Keep the times
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !valid} aria-busy={busy}>
              {busy ? "Saving…" : button}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Starting with</span>
            <Select value={first.id} onChange={(e) => setFrom(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {multiDay ? `${g.dayLabel} ` : ""}
                  {g.startLabel}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">How many minutes later</span>
            <NumberInput value={minutes} maxLength={3} onChange={(e) => setMinutes(e.target.value)} className="max-w-[8rem]" />
          </label>
        </div>
        <p>
          {first.name}
          {after > 0 ? ` and the ${after === 1 ? "1 group" : `${after} groups`} after them` : ""}
          {multiDay ? ` on ${first.dayLabel}` : ""} move {valid ? `${m} ${m === 1 ? "minute" : "minutes"}` : "that many minutes"} later. Groups before them keep their times.
        </p>
        {posted && (
          <fieldset className="space-y-2">
            <legend className="sr-only">Email the directors?</legend>
            <Choice name="push-email" checked={email} onChange={() => setEmail(true)}>
              Email the directors of {count === 1 ? "that group" : `those ${count} groups`} their new times
            </Choice>
            <Choice name="push-email" checked={!email} onChange={() => setEmail(false)}>
              Don&apos;t email anyone (the festival page updates either way)
            </Choice>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="font-semibold text-danger">
            <span aria-hidden>▲ </span>
            {error}
          </p>
        )}
      </Window>
    </>
  );
}
