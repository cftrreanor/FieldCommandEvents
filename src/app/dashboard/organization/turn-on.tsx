"use client";

import { useEffect, useRef, useState } from "react";
import { OrgBody, OrgHeading, type ShiftFacts } from "@/app/o/[slug]/parts";
import { LineIcon } from "@/components/line-icon";
import { useLeaveGuard, useUnadded } from "@/components/pending-edits";
import { toast } from "@/components/toaster";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { brandThemeCss } from "@/lib/brand-color";
import type { OrgListingEvent } from "@/lib/org-page";
import { dayRange, NEVER_LISTED, NEW_EVENTS_RULE, orgPageKindLabel, WHAT_SHOWS, WHY_LINE } from "@/lib/org-page-words";
import { turnOnOrgPage, type HelpItem } from "../org-page-actions";

export type PickEvent = {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  draft: boolean;
  /** "Sign-up open", "Sign-up opens Mon, Jan 4", "Sign-up closed", or null for a draft. */
  signup: string | null;
};

const EMAIL = /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/i;
type Errors = { name?: string; contact?: string; events?: string; other?: string };

/** The page while it's off, and the form that turns it on (board 3a, with the review's fixes). */
export function OffAndTurnOn({
  orgId,
  name: startName,
  contact: startContact,
  events,
  help,
  url,
  look,
  preview,
}: {
  orgId: string;
  name: string;
  contact: string;
  events: PickEvent[];
  /** Ways to help still showing, for the preview. */
  help: HelpItem[];
  /** The page's link, once it's been on before (it keeps it). */
  url: string | null;
  /** The group's color and logo, for the preview. */
  look: { color: string | null; logo: string | null };
  /** What each event would show today, for the preview. */
  preview: PreviewEvent[];
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Card>
        <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <Badge tone="neutral">Off</Badge>
          <span>Your organization page is off</span>
        </h2>
        <p className="mt-2 leading-7">{WHY_LINE}.</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          While it&apos;s off, nobody can open it and sign-up pages don&apos;t show your other events. Your events and their links work as usual.
        </p>
        {url && (
          <p className="mt-2 text-sm leading-6">
            Your page&apos;s link: <span className="font-mono [overflow-wrap:anywhere]">{url}</span>
          </p>
        )}
        <Button type="button" className="mt-4" onClick={() => setOpen(true)}>
          Turn on your organization page
        </Button>
      </Card>
    );
  }
  return (
    <TurnOnForm
      orgId={orgId}
      startName={startName}
      startContact={startContact}
      events={events}
      help={help}
      look={look}
      preview={preview}
      onCancel={() => setOpen(false)}
    />
  );
}

function TurnOnForm({
  orgId,
  startName,
  startContact,
  events,
  help,
  look,
  preview: previewFacts,
  onCancel,
}: {
  orgId: string;
  startName: string;
  startContact: string;
  events: PickEvent[];
  help: HelpItem[];
  look: { color: string | null; logo: string | null };
  preview: PreviewEvent[];
  onCancel: () => void;
}) {
  const [name, setName] = useState(startName);
  const [contact, setContact] = useState(startContact);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const noteUnsaved = useUnadded();
  // Leaving with the form filled in asks first: nothing is saved until Turn on page.
  useLeaveGuard("Turning on your organization page");
  useEffect(() => heading.current?.focus(), []);

  const all = events.length > 0 && ticked.size === events.length;
  const chosen = events.filter((e) => ticked.has(e.id));
  const toggle = (id: string) =>
    setTicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const nameProblem = (v: string) => (v.trim() ? undefined : "Add your group's name.");
  const contactProblem = (v: string) =>
    !v.trim() ? "Add a contact email to turn on your page." : EMAIL.test(v.trim()) ? undefined : "Check the contact email. It should look like name@example.com.";

  const focusFirst = (e: Errors) => {
    const id = e.name ? "org-name" : e.contact ? "org-contact" : null;
    if (id) document.getElementById(id)?.focus();
  };

  const submit = async () => {
    const e: Errors = { name: nameProblem(name), contact: contactProblem(contact) };
    if (e.name || e.contact) {
      setErrors(e);
      focusFirst(e);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const res = await turnOnOrgPage(orgId, { name, contact, eventIds: [...ticked] });
      if (res.error) {
        const next: Errors = res.field ? { [res.field]: res.error } : { other: res.error };
        setErrors(next);
        focusFirst(next);
      } else {
        toast("Your organization page is on.");
      }
    } catch {
      setErrors({ other: "Couldn't turn it on. Check your connection, then try again." });
    } finally {
      setBusy(false);
    }
  };

  // What the page will show, said before turning on (nothing selected is fine).
  const helpWords = help.length ? `${help.length} ${help.length === 1 ? "way" : "ways"} to help` : null;
  const willShow = chosen.length
    ? `Your page will show ${chosen.length === 1 ? "1 event" : `${chosen.length} events`}${helpWords ? ` and ${helpWords}` : ""}, once each is published and has open spots.`
    : `Nothing is selected, so your page will show ${helpWords ? `your ${helpWords} and ` : ""}your contact email until you switch events on.`;

  return (
    <Card>
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
        Turn on your organization page
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">Nothing is public until you select Turn on page. Nobody is emailed.</p>
      <form
        noValidate
        onInput={(e) => noteUnsaved(e.currentTarget)}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="mt-5 space-y-6"
      >
        <section className="space-y-4">
          <h3 className="font-semibold">The top of your page</h3>
          <Field
            label="Group name"
            hint="The heading of your page, and where its web address comes from. Use your group's name, not a person's."
            error={errors.name}
            errorId="org-name-error"
          >
            <Input
              id="org-name"
              name="name"
              value={name}
              maxLength={120}
              autoComplete="organization"
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => setErrors((x) => ({ ...x, name: nameProblem(e.target.value) }))}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "org-name-error" : undefined}
              className={errors.name ? "!border-danger" : ""}
            />
          </Field>
          <Field
            label="Contact email"
            hint="Shown at the bottom of your page, and when nothing's coming up. Use a group address if you have one, like hello@yourgroup.org."
            error={errors.contact}
            errorId="org-contact-error"
          >
            <Input
              id="org-contact"
              name="contact"
              type="email"
              value={contact}
              maxLength={254}
              autoComplete="email"
              onChange={(e) => setContact(e.target.value)}
              onBlur={(e) => e.target.value.trim() && setErrors((x) => ({ ...x, contact: contactProblem(e.target.value) }))}
              aria-invalid={errors.contact ? true : undefined}
              aria-describedby={errors.contact ? "org-contact-error" : undefined}
              className={errors.contact ? "!border-danger" : ""}
            />
          </Field>
        </section>

        <fieldset>
          <legend className="font-semibold">Which events should it show?</legend>
          <p className="mt-1 text-sm leading-6 text-muted">Your volunteer events and fairs. Select the ones to show. {NEVER_LISTED}</p>
          <p className="mt-3 rounded-md bg-brand-soft px-3 py-2 text-sm leading-6">{NEW_EVENTS_RULE}</p>
          {events.length ? (
            <>
              <button
                type="button"
                onClick={() => setTicked(all ? new Set() : new Set(events.map((e) => e.id)))}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
              >
                {all ? "Clear all" : `Select all ${events.length}`}
              </button>
              <ul className="mt-1 space-y-2">
                {events.map((e) => (
                  <li key={e.id}>
                    <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 hover:border-brand">
                      <input
                        type="checkbox"
                        checked={ticked.has(e.id)}
                        onChange={() => toggle(e.id)}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold [overflow-wrap:anywhere]">
                          {e.name}
                          {e.draft && (
                            <span className="ml-2 align-middle">
                              <Badge tone="neutral">Draft</Badge>
                            </span>
                          )}
                        </span>
                        <span className="block text-sm">
                          {orgPageKindLabel(e.kind)} · {dayRange(e.startsOn, e.endsOn)}
                        </span>
                        <span className="block text-sm text-muted">{e.draft ? (ticked.has(e.id) ? "Draft. Shows once you publish it" : "Draft. Select it to show it once it's published") : e.signup}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-sm leading-6">You don&apos;t have any volunteer events or fairs coming up yet.</p>
          )}
        </fieldset>

        <p className="text-sm leading-6">
          <LineIcon name="lock" inline />
          {WHAT_SHOWS}
        </p>

        <div className="space-y-3 border-t border-border pt-5">
          <p className="text-sm leading-6" aria-live="polite">
            {willShow}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Turning on…" : "Turn on page"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPreview(true)}>
              Preview page
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {errors.other && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {errors.other}
            </p>
          )}
        </div>
      </form>
      {preview && (
        <PreviewDialog
          name={name}
          contact={contact}
          chosen={chosen}
          preview={previewFacts}
          help={help}
          look={look}
          busy={busy}
          onTurnOn={() => {
            // Back to the form first, so a problem shows next to its box.
            setPreview(false);
            void submit();
          }}
          onClose={() => setPreview(false)}
        />
      )}
    </Card>
  );
}

/** What one event would show on the page today, for the preview (worked out on the server). */
export type PreviewEvent = { id: string; why: string | null; listing: OrgListingEvent; facts: ShiftFacts };

/**
 * The page as it will look with exactly what's selected (only the organizer sees this): built from the public page's
 * own parts (src/app/o/[slug]/parts.tsx), in the group's color with its logo, with only the selected events that
 * would show today, and buttons that go nowhere. "Turn on page" is inside it too.
 */
export function PreviewDialog({
  name,
  contact,
  chosen,
  preview,
  help,
  look,
  busy,
  onTurnOn,
  onClose,
}: {
  name: string;
  contact: string;
  chosen: PickEvent[];
  preview: PreviewEvent[];
  help: HelpItem[];
  look: { color: string | null; logo: string | null };
  busy: boolean;
  onTurnOn: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const byId = new Map(preview.map((p) => [p.id, p]));
  const picked = chosen.map((e) => byId.get(e.id)).filter((p): p is PreviewEvent => Boolean(p));
  const shown = picked.filter((p) => !p.why);
  const hidden = picked.filter((p) => p.why);
  const events = shown.map((p) => p.listing);
  const facts = new Map(shown.map((p) => [p.listing.slug, p.facts]));
  const groupName = name.trim() || "Your group's name";
  const heading = <OrgHeading name={groupName} logo={look.logo} band={Boolean(look.color)} />;
  return (
    <dialog
      ref={ref}
      aria-labelledby="org-preview-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="team-window m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-xl border border-border p-0 text-foreground shadow-elevated"
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div>
          <h2 id="org-preview-title" className="text-lg font-semibold">
            Preview of your page
          </h2>
          <p className="text-sm text-muted">Only you can see this. Its buttons don&apos;t open anything here.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => ref.current?.close()}>
          Close preview
        </Button>
      </div>
      {/* The page itself, as visitors will see it today. */}
      <div className="org-preview flex flex-col bg-background">
        {look.color && <style>{brandThemeCss(".org-preview", look.color)}</style>}
        {look.color && (
          <div className="bg-[var(--band)] text-white">
            <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">{heading}</div>
          </div>
        )}
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-8">
          {!look.color && <div className="mt-2">{heading}</div>}
          <OrgBody
            name={groupName}
            contact={contact.trim() || null}
            events={events}
            help={help}
            facts={facts}
            allFull={!events.length && hidden.some((p) => p.why === "full")}
            inert
          />
        </div>
      </div>
      <div className="sticky bottom-0 space-y-2 border-t border-border bg-surface px-4 py-3 sm:px-6">
        {hidden.length > 0 && (
          <p className="text-sm leading-6 text-muted">
            Selected but not on the page today:{" "}
            {hidden.map((p, i) => (
              <span key={p.id}>
                {i > 0 && "; "}
                <span className="font-medium text-foreground [overflow-wrap:anywhere]">{p.listing.name}</span> ({p.why})
              </span>
            ))}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={busy} onClick={onTurnOn}>
            {busy ? "Turning on…" : "Turn on page"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => ref.current?.close()}>
            Back to the form
          </Button>
        </div>
      </div>
    </dialog>
  );
}
