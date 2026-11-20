"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { publishCopy } from "@/app/dashboard/duplicate-actions";
import { toast } from "@/components/toaster";
import { Button } from "@/components/ui";
import { listAnd } from "@/lib/duplicate-words";
import { formatDate } from "@/lib/time";

export type PublishPerson = { id: string; name: string; email: string; jobs: string[]; expired: boolean };
export type PublishBlocked = { name: string; jobs: string[]; why: string };
export type UnopenedStep = { label: string; href: string };

export type Version = "now" | "later" | "plain" | "register";

/**
 * Publishing a duplicated event: the same buttons as any draft, each opening a window that says what publishing
 * does in that version (open sign-up now or later; a contest's or festival's registration, now or on its opening
 * day), lists copied steps nobody has opened, and names, ticked, who'll be emailed an invitation. Every other
 * Publish button on a never-published copy comes here (?publish=…) and opens this window. Publishing runs first, as the signed-in person (the plan is checked); then the ticked
 * invitations go. Nobody is emailed twice.
 */
export function CopyPublish({
  eventId,
  eventName,
  kind,
  previewHref,
  opensOn,
  deadline,
  people,
  blocked,
  alreadySent,
  unopened,
  host,
}: {
  eventId: string;
  eventName: string;
  kind: string;
  previewHref: string;
  /** A contest's or festival's registration opening day, when it's after today. */
  opensOn: string | null;
  deadline: string | null;
  /** Not emailed yet (or expired), and can be sent: ticked to start. */
  people: PublishPerson[];
  /** Not emailed yet, and can't be sent now (with why). */
  blocked: PublishBlocked[];
  /** Sent and still working: publishing doesn't email them again. */
  alreadySent: { name: string; sentOn: string | null }[];
  unopened: UnopenedStep[];
  /** Whoever is publishing: the email names them and gives their address for replies. */
  host: { name: string; email: string };
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [version, setVersion] = useState<Version>("now");
  const [ticked, setTicked] = useState<string[]>(people.map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const registers = kind === "band_contest" || kind === "group_event";
  const contestWord = kind === "band_contest" ? "band" : "group";
  const page = kind === "band_contest" ? "The contest page" : kind === "group_event" ? "The festival page" : "Your public page";

  const open = (v: Version) => {
    setVersion(v);
    setTicked(people.map((p) => p.id));
    setFailure(null);
    setDropped(false);
    if (!dialog.current?.open) dialog.current?.showModal();
  };
  // Another Publish button (Jobs and shifts, Band registration, Event settings) sent them here to choose.
  const query = useSearchParams();
  const asked = query.get("publish");
  useEffect(() => {
    if (!asked) return;
    const t = setTimeout(() => {
      // The version this kind has (a volunteer event opens sign-up now or later; contests and festivals register).
      open(registers ? "register" : kind === "volunteer" ? (asked === "later" ? "later" : "now") : "plain");
      // Once: the address bar loses ?publish, so a refresh doesn't open it again.
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const going = people.filter((p) => ticked.includes(p.id));
  const who = listAnd(going.map((p) => p.name));
  const count = `${going.length} ${going.length === 1 ? "Coordinator" : "Coordinators"}`;
  // Contests and festivals: the title asks one thing (publish, and email); the sentence says when registration opens.
  const doing = version === "now" ? "open sign-up" : version === "later" ? "open sign-up later" : "";
  const title = going.length
    ? `Publish ${eventName}${doing ? `, ${doing},` : ""} and email ${who}?`
    : doing
      ? `Publish ${eventName} and ${doing}?`
      : `Publish ${eventName}?`;
  const label = going.length
    ? `Publish${doing ? `, ${doing},` : ""} and email ${count}`
    : version === "now"
      ? "Publish and open sign-up"
      : version === "later"
        ? "Publish, open sign-up later"
        : version === "register"
          ? opensOn
            ? "Publish event"
            : "Publish and open registration"
          : "Publish event";
  const sentence =
    version === "now"
      ? "Your public page goes online and volunteer sign-up opens right away. Volunteers aren't emailed."
      : version === "later"
        ? "Your public page goes online. Sign-up stays closed until you open it, so people can see the event but can't sign up yet. Volunteers aren't emailed."
        : version === "register"
          ? `${page} goes online. ${contestWord === "band" ? "Band" : "Group"} registration opens ${opensOn ? `${formatDate(opensOn)}${deadline ? "," : ""}` : "right away"}${deadline ? ` and closes ${formatDate(deadline)}` : ""}. Directors aren't emailed: share the registration link or invite directors from ${kind === "band_contest" ? "Band registration" : "Registration"} when you're ready. Volunteer sign-up stays closed until you open it.`
          : "Your public page goes online. Volunteer sign-up stays closed until you open it. Volunteers aren't emailed.";

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await publishCopy(eventId, ticked, version === "now" || version === "later" ? version : undefined);
      if (r.error) {
        setBusy(false);
        // The server read the event's state before choosing these words: still a draft, nobody emailed.
        setFailure(`Couldn't publish: ${r.error.replace(/\.$/, "")}. ${eventName} is still a draft, and nobody was emailed.`);
        return;
      }
      // Shown on the event page, below its header (PublishedNote), not over its buttons.
      try {
        if (r.message) sessionStorage.setItem(NOTE_KEY(eventId), r.message);
      } catch {
        toast(r.message ?? "Published.");
      }
      dialog.current?.close();
      router.push(`/dashboard/events/${eventId}?published=1&copy=1`);
    } catch {
      // No answer: it may have published. Say so, and offer only what the page can then do: see it as it is now.
      setBusy(false);
      setDropped(true);
      setFailure(`We didn't hear back, so ${eventName} may have published. See the event as it is now: if it published, anyone not emailed is listed there to send. If not, Publish is still there, and it never emails anyone twice.`);
    }
  };

  const go = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-success px-4 text-sm font-semibold text-success-foreground shadow-sm hover:brightness-90";
  return (
    <>
      {registers ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => open("register")} className={go}>
            {opensOn ? "Publish event" : "Publish and open registration"}
          </button>
          {kind === "group_event" && (
            <a href={previewHref} target="_blank" className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
              Preview the festival page<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      ) : kind === "volunteer" ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={() => open("now")} className={go}>
              Publish and open sign-up
            </button>
            <a href={previewHref} target="_blank" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
              Preview the sign-up page
            </a>
          </div>
          <div className="text-sm">
            <p className="text-muted">Not ready for sign-ups yet? Publish now and open sign-up later. People can see the event but can&apos;t sign up.</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => open("later")}>
              Publish, open sign-up later
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <button type="button" onClick={() => open("plain")} className={go}>
            Publish event
          </button>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={(e) => busy && e.preventDefault()}
        onClick={(e) => !busy && e.target === e.currentTarget && dialog.current?.close()}
        className="team-window m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border border-border p-0 text-left text-foreground shadow-elevated"
      >
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <h2 id={titleId} className="text-xl font-semibold leading-7 [overflow-wrap:anywhere]">
              {title}
            </h2>
            <p className="mt-3 leading-7 text-muted">{sentence}</p>

            {unopened.length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm leading-6">
                <p>
                  <span className="font-semibold">Copied: check it</span> ·{" "}
                  {unopened.map((u, i) => (
                    <span key={u.label}>
                      {i > 0 && (i === unopened.length - 1 ? (unopened.length > 2 ? ", and " : " and ") : ", ")}
                      <Link href={u.href} className="font-semibold text-brand underline underline-offset-4">
                        {u.label}
                      </Link>
                    </span>
                  ))}
                </p>
                <p className="text-muted">You can still publish, and change any of it after.</p>
              </div>
            )}

            {(people.length > 0 || blocked.length > 0 || alreadySent.length > 0) && (
              <fieldset className="mt-4">
                <legend className="text-sm font-semibold">Email an invitation to</legend>
                {people.length > 0 ? (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {people.map((p) => (
                      <li key={p.id}>
                        <label className="flex min-h-11 items-start gap-3 px-3 py-3 text-sm">
                          <input
                            type="checkbox"
                            checked={ticked.includes(p.id)}
                            disabled={busy}
                            onChange={() => setTicked((t) => (t.includes(p.id) ? t.filter((x) => x !== p.id) : [...t, p.id]))}
                            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {p.name} · <span className="font-normal">{listAnd(p.jobs)}</span>
                            </span>
                            <span className="block text-muted [overflow-wrap:anywhere]">{p.email}</span>
                            {p.expired && <span className="block text-muted">Their invitation expired: this sends a new one</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">Nobody to email now.</p>
                )}
                {alreadySent.length > 0 && (
                  <p className="mt-2 text-sm leading-6">
                    Already invited: {listAnd(alreadySent.map((s) => (s.sentOn ? `${s.name} (sent ${formatDate(s.sentOn, { weekday: undefined, year: undefined })})` : s.name)))}.
                    Publishing won&apos;t email them again while {alreadySent.length === 1 ? "that invitation" : "those invitations"}{" "}
                    still {alreadySent.length === 1 ? "works" : "work"}.
                  </p>
                )}
                {blocked.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm leading-6">
                    {blocked.map((b) => (
                      <li key={b.name}>
                        <span className="font-medium">{b.name} can&apos;t be emailed now:</span> <span className="text-muted">{b.why}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {people.length > 0 && (
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Anyone left unchecked stays in Team setup as &ldquo;Not emailed yet&rdquo;, to send later. They can&apos;t help run it until they accept. Your public
                    page isn&apos;t affected. The email names you{host.name ? `, ${host.name},` : ""} and gives your address ({host.email}) for replies.
                  </p>
                )}
              </fieldset>
            )}

            {busy && (
              <p aria-live="polite" className="mt-4 text-sm font-medium">
                {going.length ? `Publishing, then sending ${going.length === 1 ? "1 invitation" : `${going.length} invitations`}…` : "Publishing…"}
              </p>
            )}
            {failure && (
              <div role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm leading-6 text-danger">
                <p>{failure}</p>
              </div>
            )}
          </div>
          {/* Pinned to the bottom of the window, so the buttons stay in reach on a phone. */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-border p-4 sm:flex-row-reverse sm:justify-start sm:px-6">
            {busy ? (
              <button type="button" aria-disabled className={`${go} cursor-wait max-sm:w-full`}>
                <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-success-foreground border-t-transparent motion-reduce:animate-none" />
                {going.length ? "Publishing and sending…" : "Publishing…"}
              </button>
            ) : (
              <button
                type="button"
                onClick={
                  dropped
                    ? () => {
                        dialog.current?.close();
                        router.refresh();
                      }
                    : submit
                }
                className={`${go} max-sm:w-full`}
              >
                {dropped ? "See the event" : failure ? "Try again" : label}
              </button>
            )}
            {!dropped && (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()} className="shrink-0 whitespace-nowrap max-sm:w-full">
                Keep it a draft
              </Button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * A Publish button elsewhere (Jobs and shifts, Band registration, Event settings) on a copy that was never
 * published: it opens the copy's publish window on the event page, so who gets emailed is always chosen.
 */
export function PublishCopyLink({ eventId, version, className = "", children }: { eventId: string; version: Version; className?: string; children: ReactNode }) {
  return (
    <Link
      href={`/dashboard/events/${eventId}?publish=${version}#publish`}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-success px-4 text-sm font-semibold text-success-foreground shadow-sm hover:brightness-90 ${className}`}
    >
      {children}
    </Link>
  );
}

const NOTE_KEY = (eventId: string) => `published-note:${eventId}`;

/**
 * After publishing a copy: what happened ("Published, and sign-up is open. Ana Silva wasn't emailed"), as a note
 * below the event's header, clear of its buttons. It closes on its own after a little while, or with its ×. The
 * not-emailed card below Links to share has the details and the buttons.
 */
export function PublishedNote({ eventId, text: given }: { eventId: string; text?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const close = () => {
    setMessage(null);
    try {
      sessionStorage.removeItem(NOTE_KEY(eventId));
    } catch {
      // Nothing stored.
    }
  };
  useEffect(() => {
    let text: string | null = given ?? null;
    if (!given) {
      try {
        // Read, not removed yet: removed once it closes (a second render reads the same note).
        text = sessionStorage.getItem(NOTE_KEY(eventId));
      } catch {
        // No storage: the event page still shows everything below.
      }
    }
    const show = setTimeout(() => setMessage(text), 0);
    const hide = text ? setTimeout(() => close(), 12_000) : undefined;
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, given]);
  if (!message) return null;
  return (
    <div role="status" className="mt-4 flex items-start gap-3 rounded-lg border border-success/40 bg-success-soft px-4 py-3 text-sm leading-6">
      <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success text-xs font-bold text-success-foreground">
        ✓
      </span>
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        aria-label="Close"
        onClick={() => close()}
        className="-my-1 -mr-2 grid size-11 shrink-0 place-items-center rounded-md text-lg leading-none text-muted hover:bg-background hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}
