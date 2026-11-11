"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { flushPending, settled } from "@/components/pending-edits";
import { Button } from "@/components/ui";
import { directorsOf } from "@/lib/rooms";
import { formatDate } from "@/lib/time";
import { emailNewTimes, postPreview, postSchedule, saveRooms, sendTheRest, type PostPreview } from "./actions";
import { Window } from "./windows";

const NOTE = "rounded-md border border-warning/40 bg-warning-soft p-4 leading-6";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Post the schedule" (board 11): waits for anything still saving, then asks first, naming who is emailed, each
 * day's span, groups with no times, requests not met, and (while registration is open) that later groups get times
 * when they're added. A room with two groups at once blocks it, with the fix as the button.
 */
export function PostButton({ eventId, rooms }: { eventId: string; rooms: number }) {
  const router = useRouter();
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    flushPending();
    await settled();
    const p = await postPreview(eventId).catch(() => ({ error: "Check your connection, then try again." }));
    setBusy(false);
    if ("error" in p) return setError(p.error);
    setPreview(p);
  };

  const post = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const r = await postSchedule(eventId, { expectedVersion: preview.version }).catch(() => ({ error: "Check your connection, then try again." }));
    setBusy(false);
    if ("conflict" in r) {
      // Someone changed it a moment ago: show the window again with what's saved now.
      setError(`${r.conflict.changes[0].name} changed the schedule just now. Check the times below, then post.`);
      return void open();
    }
    if ("error" in r) return setError(r.error);
    setPreview(null);
    router.refresh();
  };

  const fix = async () => {
    if (!preview?.long) return;
    setBusy(true);
    const p = preview;
    const minutes = p.long!.minutes;
    // Only the spacing changes; the walking time stays as saved.
    const r = await saveRooms(eventId, {
      rooms: null,
      interval: minutes,
      passing: null,
      expectedVersion: p.version,
      summary: `A new group starts every ${minutes} minutes (was ${p.long!.interval})`,
      email: false,
    }).catch(() => ({ error: "Check your connection, then try again." }));
    setBusy(false);
    if ("error" in r) return setError(r.error);
    router.refresh();
    void open();
  };

  const p = preview;
  const n = p?.emailed ?? 0;
  const directors = directorsOf(n);
  return (
    <>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Button type="button" onClick={() => void open()} disabled={busy || rooms === 0} aria-busy={busy && !p}>
          {busy && !p ? "Checking…" : "Post the schedule"}
        </Button>
        {error && !p && (
          <p role="alert" className="text-sm font-semibold text-danger">
            <span aria-hidden>▲ </span>
            {error}
          </p>
        )}
      </div>
      <Window
        open={Boolean(p)}
        title={p?.long ? "Can't post yet" : n === 0 ? "No group has times yet" : `Post the schedule and email ${directors}?`}
        onClose={() => !busy && setPreview(null)}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
              Keep editing
            </Button>
            {p?.long ? (
              <Button type="button" onClick={() => void fix()} disabled={busy} aria-busy={busy}>
                {busy ? "Saving…" : `Start a group every ${p.long.minutes} minutes`}
              </Button>
            ) : (
              n > 0 && (
                <Button type="button" onClick={() => void post()} disabled={busy} aria-busy={busy}>
                  {busy ? "Posting…" : `Post and email ${directors}`}
                </Button>
              )
            )}
          </>
        }
      >
        {p?.long ? (
          <div className={NOTE}>
            <p className="font-semibold">
              <span aria-hidden>◆ </span>A room would have two groups at once
            </p>
            <p>
              {p.long.room} is {p.long.minutes} minutes, but a new group starts every {p.long.interval} minutes. Start a group every {p.long.minutes} minutes, or shorten{" "}
              {p.long.room} in the Rooms tab, before you post.
            </p>
          </div>
        ) : n === 0 ? (
          <p>Give groups times in the Group times tab first. Then post the schedule.</p>
        ) : (
          p && (
            <>
              <p>Each director gets their group&apos;s times, and the schedule shows on the festival page.</p>
              <ul className="list-disc pl-5">
                {p.days.map((d) => (
                  <li key={d.label}>
                    {d.label}: {plural(d.groups, "group", "groups")}, {d.from} to {d.to}
                  </li>
                ))}
              </ul>
              {p.noTimes.length > 0 && (
                <div className={NOTE}>
                  <p className="font-semibold">
                    <span aria-hidden>◆ </span>
                    {p.noTimes.length === 1 ? "1 group has no times" : `${p.noTimes.length} groups have no times`}
                  </p>
                  <p>
                    {p.noTimes.join(", ")}. {p.noTimes.length === 1 ? "Its directors aren't" : "Their directors aren't"} emailed until you add{" "}
                    {p.noTimes.length === 1 ? "it" : "them"}.
                  </p>
                </div>
              )}
              {p.broken.length > 0 && (
                <div className={NOTE}>
                  <p className="font-semibold">
                    <span aria-hidden>◆ </span>
                    {p.broken.length === 1 ? "1 request isn't met" : `${p.broken.length} requests aren't met`}
                  </p>
                  {p.broken.map((b) => (
                    <p key={b.name}>
                      {b.name}: {b.text.replace(/^Their director/, "their director")}
                    </p>
                  ))}
                </div>
              )}
              {p.regOpen && (
                <p>
                  Registration is still open{p.deadline ? ` through ${formatDate(p.deadline, { year: undefined })}` : ""}. Groups that register later won&apos;t have times
                  until you add them. Then only their directors are emailed.
                </p>
              )}
              {p.previewBand && (
                <a
                  href={`/dashboard/events/${eventId}/rooms/email-preview?band=${p.previewBand}`}
                  target="_blank"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
                >
                  Preview the email<span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </>
          )
        )}
        {error && p && (
          <p role="alert" className="font-semibold text-danger">
            <span aria-hidden>▲ </span>
            {error}
          </p>
        )}
      </Window>
    </>
  );
}

/** Emails that didn't go: send the rest again, on every list that has any left. */
export function SendTheRest({ eventId, label }: { eventId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        await sendTheRest(eventId).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Sending…" : label}
    </Button>
  );
}

/**
 * The festival's dates or time zone moved its posted times: the organizer's choice to email every director their
 * times now (it's never automatic).
 */
export function EmailNewTimes({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await emailNewTimes(eventId).catch(() => ({ error: "Check your connection, then try again." }));
          setBusy(false);
          if ("error" in r) return setError(r.error);
          router.refresh();
        }}
      >
        {busy ? "Emailing…" : "Email directors their new times"}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>
          {error}
        </p>
      )}
    </div>
  );
}
