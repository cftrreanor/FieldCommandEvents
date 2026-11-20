"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { fixCopyCoordinatorEmail, removeCopyCoordinator, sendCopyInvitationNow, undoRemoveCopyCoordinator } from "@/app/dashboard/duplicate-actions";
import { cancelInvitation, resendInvitation } from "@/app/dashboard/team-actions";
import { ActionForm } from "@/components/action-form";
import { confirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toaster";
import { Button, Field, Input } from "@/components/ui";
import { CopyInviteLink, ROW_BUTTON, UndoNote } from "@/app/dashboard/team/team-ui";
import { firstName, listAnd } from "@/lib/duplicate-words";
import { formatDate } from "@/lib/time";

export type CopiedPerson = {
  id: string;
  name: string;
  email: string;
  jobs: string[];
  status: "held" | "sent" | "expired" | "accepted";
  /** The ladder's words ("Not emailed yet · sent when you publish"). */
  statusText: string;
  dot: boolean;
  tone: "warn" | "good" | "plain";
  canSend: boolean;
  /** A sent invitation's link, for Copy link. */
  url: string | null;
  /** What Send now's window says the invitation works until (30 days from today). */
  until: string;
};

/** "Fix the address": a box for the right email, then Save and send (or Save, before publishing). */
export function FixAddress({ eventId, person, send, onDone }: { eventId: string; person: { id: string; name: string; email: string }; send: boolean; onDone: () => void }) {
  return (
    <ActionForm action={fixCopyCoordinatorEmail.bind(null, eventId, person.id)} resetOnSuccess={false} onSuccess={onDone} className="mt-3 w-full space-y-3">
      {send && <input type="hidden" name="send" value="1" />}
      <Field label={`${person.name}'s email`}>
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

/**
 * A duplicated event's copied Coordinators in Team setup: name, then email, then one status ladder ("Not emailed
 * yet · sent when you publish", "Invitation sent [date]", "Invitation expired [date]" beside Send again, "Accepted"). Send now
 * asks first; Remove of someone not emailed has Undo instead of a question.
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
  const [undo, setUndo] = useState<{ removalId: string; name: string; message: string; until: string } | null>(null);

  const sendNow = async (p: CopiedPerson) => {
      if (!published && p.status === "held") {
        const ok = await confirmDialog({
          title: `Email ${p.name} their invitation now?`,
          bullets: [
            `${firstName(p.name)} can accept before you publish, then open ${eventName} as a draft, as ${leadTitle} for ${listAnd(p.jobs)}`,
            `A draft has no volunteers, so ${firstName(p.name)} sees nobody's details until people sign up`,
            `The invitation works for 30 days, until ${formatDate(p.until)}`,
            `Publishing won't email ${firstName(p.name)} again while it still works`,
          ],
          confirmLabel: "Send invitation now",
          cancelLabel: "Wait until I publish",
        });
        if (!ok) return;
      }
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
      setUndo({ removalId: r.undoId, name: p.name, message: `${r.message ?? `Removed ${p.name}.`} You can add ${firstName(p.name)} again.`, until: new Date(Date.now() + 10 * 60_000).toISOString() });
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
      {people.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {people.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium [overflow-wrap:anywhere]">
                  {p.name} · <span className="font-normal">{leadTitle} for {listAnd(p.jobs)}</span>
                </p>
                {p.name !== p.email && <p className="text-muted [overflow-wrap:anywhere]">{p.email}</p>}
                <p className={`mt-1 flex gap-2 ${p.tone === "good" ? "text-success" : ""}`}>
                  {p.dot && <span aria-hidden className="mt-1.5 inline-block size-2.5 shrink-0 rounded-full bg-warning" />}
                  {p.tone === "good" && <span aria-hidden>✓</span>}
                  <span>{p.statusText}</span>
                </p>
              </div>
              {p.status !== "accepted" && fixing !== p.id && (
                <div className="flex flex-wrap items-center gap-1">
                  {(p.status === "held" || p.status === "expired") && p.canSend && (
                    <Button type="button" variant="secondary" className={ROW_BUTTON} disabled={pending} onClick={() => sendNow(p)} aria-label={`${p.status === "expired" ? "Send again" : published ? "Send" : "Send now"} to ${p.name}`}>
                      {p.status === "expired" ? "Send again" : published ? "Send" : "Send now"}
                    </Button>
                  )}
                  {p.status === "held" && (
                    <Button type="button" variant="secondary" className={ROW_BUTTON} onClick={() => setFixing(p.id)} aria-label={`Fix the address for ${p.name}`}>
                      Fix the address
                    </Button>
                  )}
                  {p.status === "sent" && (
                    <>
                      <ActionForm action={resendInvitation.bind(null, eventId, p.id)} resetOnSuccess={false} className="contents">
                        <SubmitButton variant="secondary" pendingText="Sending…" className={ROW_BUTTON} aria-label={`Resend invitation to ${p.email}`}>
                          Resend
                        </SubmitButton>
                      </ActionForm>
                      {p.url && <CopyInviteLink url={p.url} email={p.email} />}
                    </>
                  )}
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
              {fixing === p.id && <FixAddress eventId={eventId} person={p} send={published} onDone={() => setFixing(null)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * On a published copy's event page, until each is sent or removed: who wasn't emailed, with Fix the address first,
 * then Send, and the way to Team setup.
 */
export function NotEmailedLine({ eventId, people, teamHref }: { eventId: string; people: CopiedPerson[]; teamHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [fixing, setFixing] = useState<string | null>(null);
  if (!people.length) return null;
  return (
    <section id="not-emailed" aria-label="Not emailed yet" className="mt-6 scroll-mt-6 rounded-lg border border-warning/50 bg-warning-soft px-4 py-3 text-sm leading-6">
      <p className="font-semibold">
        {people.length === 1 ? `${people[0].name} wasn't emailed` : `${people.length} Coordinators weren't emailed`}
      </p>
      <p>
        Nobody can open the event until they&apos;re invited and accept. They show as Not emailed yet in{" "}
        <a href={teamHref} className="font-semibold text-brand underline underline-offset-4">
          Team setup
        </a>
        .
      </p>
      <ul className="mt-2 space-y-2">
        {people.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <span className="min-w-0">
              <span className="font-medium">{p.name}</span> · {listAnd(p.jobs)}
              {p.name !== p.email && <span className="block text-muted [overflow-wrap:anywhere]">{p.email}</span>}
              {!p.canSend && <span className="block text-muted">{p.statusText}</span>}
            </span>
            {fixing !== p.id && (
              <span className="flex flex-wrap gap-2">
                {p.status === "held" && (
                  <Button type="button" variant="secondary" className={ROW_BUTTON} onClick={() => setFixing(p.id)} aria-label={`Fix the address for ${p.name}`}>
                    Fix the address
                  </Button>
                )}
                {p.canSend && (
                  <Button
                    type="button"
                    variant="secondary"
                    className={ROW_BUTTON}
                    disabled={pending}
                    aria-label={`Send ${p.name} their invitation`}
                    onClick={() =>
                      start(async () => {
                        const r = await sendCopyInvitationNow(eventId, p.id);
                        toast(r.error ?? r.message ?? "Sent.");
                        router.refresh();
                      })
                    }
                  >
                    Send
                  </Button>
                )}
              </span>
            )}
            {fixing === p.id && <FixAddress eventId={eventId} person={p} send onDone={() => setFixing(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
