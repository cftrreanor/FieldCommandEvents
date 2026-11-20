"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { fixCopyCoordinatorEmail, removeCopyCoordinator, sendCopyInvitationNow, undoRemoveCopyCoordinator } from "@/app/dashboard/duplicate-actions";
import { cancelInvitation } from "@/app/dashboard/team-actions";
import { ActionForm } from "@/components/action-form";
import { confirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toaster";
import { Button, Field, Input } from "@/components/ui";
import { CopyInviteLink, ROW_BUTTON, UndoNote } from "@/app/dashboard/team/team-ui";
import { firstName, listAnd, sendLabel } from "@/lib/duplicate-words";
import { formatDate } from "@/lib/time";

export type CopiedPerson = {
  id: string;
  name: string;
  email: string;
  jobs: string[];
  status: "held" | "sent" | "expired" | "accepted";
  /** The ladder's words ("Not emailed yet · sent when you publish"). */
  statusText: string;
  /** Needs something (not emailed yet, or expired): the ◆ marker, with the words. */
  dot: boolean;
  tone: "warn" | "good" | "plain";
  canSend: boolean;
  /** A sent invitation's link, for Copy link. */
  url: string | null;
  /** What the send window says the invitation works until (30 days from today). */
  until: string;
};

const QUIET_LINK = "inline-flex min-h-11 items-center px-2 text-sm font-medium text-brand underline underline-offset-4";

/** "Change email": a box for the right address, then Save and send (or Save, before publishing). */
export function ChangeEmail({ eventId, person, send, onDone }: { eventId: string; person: { id: string; name: string; email: string }; send: boolean; onDone: () => void }) {
  return (
    <ActionForm action={fixCopyCoordinatorEmail.bind(null, eventId, person.id)} resetOnSuccess={false} onSuccess={onDone} className="mt-3 w-full space-y-3">
      {send && <input type="hidden" name="send" value="1" />}
      <Field label={person.name === person.email ? "Their email" : `${person.name}'s email`}>
        <Input name="email" type="email" inputMode="email" autoComplete="off" defaultValue={person.email} required autoFocus />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText={send ? "Sending…" : "Saving…"}>{send ? "Save and send" : "Save"}</SubmitButton>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </ActionForm>
  );
}

/** The confirm before emailing one person early (before publishing). */
async function confirmEarly(p: CopiedPerson, eventName: string, leadTitle: string) {
  const first = firstName(p.name === p.email ? "They" : p.name);
  return confirmDialog({
    title: `Email ${p.name} their invitation now?`,
    bullets: [
      `Once ${first} accepts, ${first === "They" ? "they" : first} can open ${eventName} while it's still a draft, to lead ${listAnd(p.jobs)} as ${leadTitle}`,
      `A draft has no volunteers, so nobody's details are shown until people sign up`,
      `The invitation works for 30 days, until ${formatDate(p.until)}`,
      `Publishing won't email ${first === "They" ? "them" : first} again while it still works`,
    ],
    confirmLabel: "Send invitation now",
    cancelLabel: "Wait until I publish",
  });
}

const UNDO_KEY = (eventId: string) => `copied-undo:${eventId}`;
type Undo = { removalId: string; name: string; message: string; until: string };

/**
 * A duplicated event's copied Coordinators still waiting (not emailed yet, sent, or expired), as rows of Team
 * setup's Pending list: one row per person, one status, one next action. The main button first ("Send invitation
 * now", "Send invitation", or "Send a new invitation"), then "Change email" as a quiet link, then Remove (or Cancel
 * invitation). Someone who accepts moves to Current members.
 */
export function CopiedCoordinators({
  eventId,
  eventName,
  people,
  published,
  leadTitle,
}: {
  eventId: string;
  eventName: string;
  people: CopiedPerson[];
  published: boolean;
  leadTitle: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fixing, setFixing] = useState<string | null>(null);
  // Kept for this tab (not only this render), so Undo looks the same after a refresh or at any width.
  const [undo, setUndoState] = useState<Undo | null>(null);
  useEffect(() => {
    // After hydrating (storage is the browser's).
    const t = setTimeout(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(UNDO_KEY(eventId)) ?? "null") as Undo | null;
        if (saved && new Date(saved.until).getTime() > Date.now()) setUndoState(saved);
      } catch {
        // No storage: Undo still works until the page is left.
      }
    }, 0);
    return () => clearTimeout(t);
  }, [eventId]);
  const setUndo = (u: Undo | null) => {
    setUndoState(u);
    try {
      if (u) sessionStorage.setItem(UNDO_KEY(eventId), JSON.stringify(u));
      else sessionStorage.removeItem(UNDO_KEY(eventId));
    } catch {
      // As above.
    }
  };
  const waiting = people.filter((p) => p.status !== "accepted");

  const send = async (p: CopiedPerson) => {
    if (!published && p.status === "held" && !(await confirmEarly(p, eventName, leadTitle))) return;
    start(async () => {
      const r = await sendCopyInvitationNow(eventId, p.id);
      toast(r.error ?? r.message ?? "Sent.");
      router.refresh();
    });
  };

  const remove = (p: CopiedPerson) =>
    start(async () => {
      const r = await removeCopyCoordinator(eventId, p.id);
      if (r.error || !r.undoId) {
        toast(r.error ?? "Couldn't remove them. Try again.");
        return;
      }
      setUndo({ removalId: r.undoId, name: p.name, message: r.message ?? `Removed ${p.name}.`, until: new Date(Date.now() + 10 * 60_000).toISOString() });
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {undo && (
        <UndoNote
          until={undo.until}
          minutes={10}
          name={undo.name}
          action={async () => {
            const r = await undoRemoveCopyCoordinator(eventId, undo.removalId);
            if (r.ok) setUndo(null);
            return r;
          }}
        >
          <p>{undo.message}</p>
        </UndoNote>
      )}
      {waiting.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-dashed border-field-border">
          {waiting.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">{p.name}</p>
                <p className="text-muted [overflow-wrap:anywhere]">
                  {p.name !== p.email ? `${p.email} · ` : ""}
                  {leadTitle} for {listAnd(p.jobs)}
                </p>
                <p className={`mt-0.5 ${p.dot ? "font-medium text-warning" : ""}`}>
                  {p.dot && <span aria-hidden>◆ </span>}
                  {p.statusText}
                </p>
              </div>
              {fixing !== p.id && (
                <div className="flex flex-wrap items-center gap-1">
                  {p.canSend && p.status !== "sent" && (
                    <Button type="button" variant="secondary" className={ROW_BUTTON} disabled={pending} onClick={() => send(p)} aria-label={`${sendLabel(p.status, published)} to ${p.name}`}>
                      {sendLabel(p.status, published)}
                    </Button>
                  )}
                  {p.status === "sent" && (
                    // Delivery can be unknown (a send cut off partway): a new invitation is always one press away.
                    <Button type="button" variant="secondary" className={ROW_BUTTON} disabled={pending} onClick={() => send(p)} aria-label={`Send a new invitation to ${p.name}`}>
                      Send a new invitation
                    </Button>
                  )}
                  {p.status === "held" && (
                    <button type="button" className={QUIET_LINK} onClick={() => setFixing(p.id)} aria-label={`Change email for ${p.name}`}>
                      Change email
                    </button>
                  )}
                  {p.status === "sent" && p.url && <CopyInviteLink url={p.url} email={p.email} />}
                  {p.status === "sent" ? (
                    <ActionForm
                      action={cancelInvitation.bind(null, eventId, p.id)}
                      confirmMessage={`Cancel the invitation for ${p.email}? The link stops working. Nobody is emailed.`}
                      confirmLabel="Cancel invitation"
                      cancelLabel="Keep it"
                      resetOnSuccess={false}
                      className="contents"
                    >
                      <SubmitButton variant="quiet-danger" pendingText="Cancelling…" className={ROW_BUTTON}>
                        Cancel invitation
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <Button type="button" variant="quiet-danger" className={ROW_BUTTON} disabled={pending} onClick={() => remove(p)} aria-label={`Remove ${p.name}`}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
              {fixing === p.id && <ChangeEmail eventId={eventId} person={p} send={published} onDone={() => setFixing(null)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * On a published copy's event page, until each is sent or removed: who wasn't emailed, with the same buttons in the
 * same order as Team setup (Send invitation, then Change email). After sending, the card says so.
 */
export function NotEmailedLine({ eventId, people, teamHref }: { eventId: string; people: CopiedPerson[]; teamHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fixing, setFixing] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  if (!people.length && !sent.length) return null;
  return (
    <section id="not-emailed" aria-label="Not emailed yet" className={`mt-6 scroll-mt-6 rounded-lg border px-4 py-3 text-sm leading-6 ${people.length ? "border-warning/50 bg-warning-soft" : "border-success/40 bg-success-soft"}`}>
      {people.length > 0 ? (
        <>
          <p className="font-semibold">
            <span aria-hidden>◆ </span>
            {people.length === 1 ? `${people[0].name} wasn't emailed` : `${people.length} Coordinators weren't emailed`}
          </p>
          <p>
            They can&apos;t help run it until they&apos;re invited and accept. Your public page isn&apos;t affected. They show as Not emailed yet in{" "}
            <a href={teamHref} className="font-semibold text-brand underline underline-offset-4">
              Team setup
            </a>
            .
          </p>
        </>
      ) : null}
      {sent.length > 0 && (
        <p className={people.length ? "mt-2" : "font-semibold text-success"} role="status">
          <span aria-hidden>✓ </span>
          Invitation sent to {listAnd(sent)}.{people.length ? "" : " They show as Invitation sent in Team setup."}
        </p>
      )}
      {people.length > 0 && (
        <ul className="mt-2 space-y-2">
          {people.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="font-medium">{p.name}</span> · {listAnd(p.jobs)}
                {p.name !== p.email && <span className="block text-muted [overflow-wrap:anywhere]">{p.email}</span>}
                {!p.canSend && <span className="block text-muted">{p.statusText}</span>}
              </span>
              {fixing !== p.id && (
                <span className="flex flex-wrap items-center gap-1">
                  {p.canSend && (
                    <Button
                      type="button"
                      variant="secondary"
                      className={ROW_BUTTON}
                      disabled={pending}
                      aria-label={`${sendLabel(p.status, true)} to ${p.name}`}
                      onClick={() =>
                        start(async () => {
                          const r = await sendCopyInvitationNow(eventId, p.id);
                          if (r.ok) setSent((s) => [...s, p.name]);
                          else toast(r.error ?? "Couldn't send it. Try again.");
                          router.refresh();
                        })
                      }
                    >
                      {sendLabel(p.status, true)}
                    </Button>
                  )}
                  {p.status === "held" && (
                    <button type="button" className={QUIET_LINK} onClick={() => setFixing(p.id)} aria-label={`Change email for ${p.name}`}>
                      Change email
                    </button>
                  )}
                </span>
              )}
              {fixing === p.id && <ChangeEmail eventId={eventId} person={p} send onDone={() => setFixing(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
