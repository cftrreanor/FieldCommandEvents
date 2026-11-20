import Link from "next/link";
import { cache, type ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import { requireUser } from "@/lib/auth";
import { loadCopyPublishCheck, type CopyPublishCheck, type DuplicateSummary } from "@/lib/duplicate-event";
import { addDays, firstName, listAnd, mapsAndDocuments, newDateSpotHref, newDateSpotLabel, offsetWords, places, plural, shortRange, type NewDateSpot } from "@/lib/duplicate-words";
import { loadAccountHost } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate, utcToZonedTime } from "@/lib/time";
import { StartOverButton } from "./start-over";

export type CopyFacts = {
  check: CopyPublishCheck;
  summary: DuplicateSummary;
  event: {
    id: string;
    name: string;
    event_type: string;
    status: string;
    organization_id: string;
    timezone: string;
    starts_on: string;
    ends_on: string;
    window_start: string;
    window_end: string;
    payment_link: string | null;
    meals_offered: boolean | null;
    meal_price_cents: number | null;
  };
  /** Copied shifts that start or end outside the event's hours. */
  shiftsOutside: number;
  files: number;
  /** A contest's or festival's contact for directors, which came over ("Dina Owner, (512) 555-0100"). */
  directorContact: string | null;
};

/**
 * A duplicated event's facts for its note and publish window; null for any other event (or before the update).
 * Once per request, however many places ask.
 */
export const loadCopyFacts = cache(async (eventId: string): Promise<CopyFacts | null> => {
  const check = await loadCopyPublishCheck(eventId);
  if (!check) return null;
  const supabase = await createClient();
  const [{ data: copy }, { data: event }, { data: shifts }, { count: files }, { data: contact }] = await Promise.all([
    supabase.from("event_copies").select("summary").eq("event_id", eventId).maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_type, status, organization_id, timezone, starts_on, ends_on, window_start, window_end, payment_link, meals_offered, meal_price_cents")
      .eq("id", eventId)
      .maybeSingle(),
    supabase.from("shifts").select("starts_at, ends_at").eq("event_id", eventId),
    supabase.from("event_files").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("event_director_contacts").select("name, phone, email").eq("event_id", eventId).maybeSingle(),
  ]);
  if (!copy || !event) return null;
  const tz = event.timezone || "America/Chicago";
  const open = utcToZonedTime(event.window_start, tz).slice(0, 5);
  const close = utcToZonedTime(event.window_end, tz).slice(0, 5);
  const shiftsOutside = ((shifts ?? []) as { starts_at: string; ends_at: string }[]).filter(
    (s) => utcToZonedTime(s.starts_at, tz).slice(0, 5) < open || utcToZonedTime(s.ends_at, tz).slice(0, 5) > close,
  ).length;
  const directorContact = contact ? [contact.name, contact.phone, contact.email].filter(Boolean).join(", ") || null : null;
  return { check, summary: copy.summary as DuplicateSummary, event: event as CopyFacts["event"], shiftsOutside, files: files ?? 0, directorContact };
});

const LINK = "font-semibold text-brand underline underline-offset-4";

/** What happened to each registration date: moved, or left blank (and why). */
export function registrationLines(f: CopyFacts, place: "here" | "elsewhere"): string[] {
  const r = f.summary.registration;
  if (!r) return [];
  const where = place === "here" ? "below" : `on ${f.event.event_type === "group_event" ? "Registration" : "Band registration"}`;
  const today = utcToZonedDate(new Date().toISOString(), f.event.timezone || "America/Chicago");
  const would = (was: string | null) => (was ? addDays(was, f.check.days_moved) : null);
  const why = (d: string | null) => (d && d < today ? "which has passed" : `which isn't before the ${f.event.event_type === "group_event" ? "festival" : "contest"}`);
  const deadlineWould = would(r.deadline_was);
  const opensWould = would(r.opens_on_was);
  return [
    r.deadline_left_blank
      ? place === "here"
        ? "The deadline is blank: pick a new one below"
        : `The registration deadline is blank: it would have been ${deadlineWould ? formatDate(deadlineWould) : "a past day"}, ${why(deadlineWould)}. Pick a new one ${where}`
      : r.deadline
        ? `The registration deadline moved to ${formatDate(r.deadline)}`
        : null,
    r.opens_on_left_blank
      ? `The opening day is blank (it would have been ${opensWould ? formatDate(opensWould) : "a past day"}), so registration opens when you publish`
      : r.opens_on
        ? `Registration opens ${formatDate(r.opens_on)}`
        : null,
  ].filter((x): x is string => Boolean(x));
}

/**
 * "[new date]" places on a copy, each a link to where it's filled in, grouped under the page where it's fixed
 * ("Details", "Maps and documents", "Jobs and shifts"). Wraps in full on phones ("[new date]" is never cut off).
 */
export function NewDateList({
  base,
  spots,
  className = "",
  groupLabel,
}: {
  base: string;
  spots: NewDateSpot[];
  className?: string;
  /** The page each place is fixed on, as a heading over its places (Maps and documents has its own, with its link). */
  groupLabel?: (step: string) => { label: string; href: string };
}) {
  if (!spots.length) return null;
  const item = (s: NewDateSpot, i: number) => (
    <li key={`${s.step}-${s.what}-${s.station_id ?? s.job ?? ""}-${s.detail ?? i}`} className="[overflow-wrap:anywhere]">
      <Link href={newDateSpotHref(base, s)} className={LINK}>
        {newDateSpotLabel(s)}
      </Link>
      {s.what === "item" && s.job && s.job !== "Things to bring" ? <span className="text-muted"> · {s.job}</span> : null}
      {s.count > 1 && <span className="text-muted"> · {places(s.count)}</span>}
    </li>
  );
  if (!groupLabel) return <ul className={`space-y-1 ${className}`}>{spots.map(item)}</ul>;
  const steps = [...new Set(spots.map((s) => s.step))];
  return (
    <div className={`space-y-2 ${className}`}>
      {steps.map((step) => {
        const here = spots.filter((s) => s.step === step);
        const g = groupLabel(step);
        return (
          <div key={step}>
            {/* The page's name is a heading (its places below are the links). */}
            <p className="font-semibold text-foreground">
              {g.label} <span className="font-normal text-muted">· {places(here.reduce((n, s) => n + s.count, 0))}</span>
            </p>
            <ul className="mt-0.5 space-y-1 pl-4">{here.map(item)}</ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The "Copied from" note on a duplicated draft (its event page, and a contest's Band registration): where it came
 * from and how far the dates moved, what to look over as plain links (the step bar stays the one tracker), who
 * isn't emailed yet, and the quiet "Delete and start over" after it.
 */
export async function CopiedNote({ facts: f, place = "event" }: { facts: CopyFacts; place?: "event" | "registration" }) {
  const { check, summary, event } = f;
  if (event.status !== "draft") return null;
  const base = `/dashboard/events/${event.id}`;
  const contest = event.event_type === "band_contest" || event.event_type === "group_event";
  const regName = event.event_type === "group_event" ? "Registration" : "Band registration";
  const items: { href: string; link: string; where: string }[] = contest
    ? [
        { href: `${base}/bands`, link: "The fee in the information for directors", where: regName },
        ...(event.payment_link ? [{ href: `${base}/bands`, link: "The payment link", where: regName }] : []),
        ...(event.meals_offered
          ? [{ href: `${base}/bands`, link: "The meal price", where: event.meal_price_cents != null ? `$${(event.meal_price_cents / 100).toFixed(event.meal_price_cents % 100 ? 2 : 0)}, ${regName}` : regName }]
          : []),
        // Last time's phone and email for directors came over too: say so.
        ...(f.directorContact ? [{ href: `${base}/bands`, link: "The contact for directors", where: `${f.directorContact}, ${regName}` }] : []),
        ...(f.shiftsOutside
          ? [{ href: `${base}/volunteering`, link: `${plural(f.shiftsOutside, "shift", "shifts")} outside the ${event.event_type === "band_contest" ? "contest's" : "festival's"} hours`, where: "Jobs and shifts" }]
          : []),
        { href: `${base}/edit`, link: "The description", where: "Details" },
        ...(f.files ? [{ href: `${base}/edit?section=files`, link: "Maps and documents", where: `${mapsAndDocuments(f.files)} came over` }] : []),
        { href: `${base}/edit?section=emails`, link: "Where replies go, and who gets notified", where: "Email settings, not copied" },
      ]
    : [
        { href: `${base}/edit`, link: "The description", where: "Details" },
        ...(f.files ? [{ href: `${base}/edit?section=files`, link: "Maps and documents", where: `${mapsAndDocuments(f.files)} came over` }] : []),
        { href: `${base}/edit?section=emails`, link: "Where replies go, and who gets notified", where: "Email settings, not copied" },
      ];
  // On Band registration, its own items say "below".
  const shown = place === "registration" ? items.map((i) => (i.href === `${base}/bands` ? { ...i, where: i.where === regName ? "below" : i.where } : i)) : items;

  const held = check.invitations.filter((i) => i.status === "held" || i.status === "expired");
  const emailedBefore = check.invitations.filter((i) => i.status === "expired");
  const tz = event.timezone || "America/Chicago";
  const sent = check.invitations.filter((i) => i.status === "sent");
  // How many Coordinators already on the account's team kept their jobs (the stored summary keeps counts only).
  const added = typeof summary.coordinators?.added === "number" ? summary.coordinators.added : 0;
  const reg = registrationLines(f, place === "registration" ? "here" : "elsewhere");
  const user = await requireUser();
  const supabase = await createClient();
  const me = check.discard_blocker ? await loadAccountHost(supabase, event.organization_id, user.id) : null;
  // Reader-specific: the Account Host is told where they can delete it, not to ask themselves.
  const blocker = check.discard_blocker && me?.isMe ? check.discard_blocker.replace("The Account Host can delete it in Event settings.", "You can delete it in Event settings, Publishing and more.") : check.discard_blocker;
  const bullets = [
    `Deletes this copy: ${listAnd(
      [
        summary.jobs ? plural(summary.jobs, "job", "jobs") : "",
        summary.shifts ? plural(summary.shifts, "shift", "shifts") : "",
        summary.items ? plural(summary.items, "thing to bring", "things to bring") : "",
        summary.rooms ? plural(summary.rooms, "room", "rooms") : "",
        f.files ? mapsAndDocuments(f.files) : "",
      ].filter(Boolean),
    ) || "its details"}`,
    "Any changes you've made to it go too",
    ...(sent.length
      ? sent.map(
          (s) =>
            `${s.name}'s invitation, sent ${s.sent_at ? formatDate(utcToZonedDate(s.sent_at, tz), { weekday: undefined, year: undefined }) : "already"}, stops working: if ${firstName(s.name)} opens it, it says it wasn't found. Nobody is emailed`,
        )
      : emailedBefore.length
        ? [`${listAnd(emailedBefore.map((p) => p.name))} ${emailedBefore.length === 1 ? "was" : "were"} emailed an invitation that has expired. Nobody is emailed now`]
        : [`It was never published, and nobody was emailed${held.length ? `, including the ${plural(held.length, "Coordinator", "Coordinators")}` : ""}`]),
    `${check.source?.name ?? "The event you duplicated"} doesn't change`,
    "You go back to Duplicate event, with the name and first day kept",
  ];
  const sourceLine = (
    <>
      <span className="font-semibold">
        Copied from {check.source?.name ?? "an earlier event"}
        {check.source ? ` (${shortRange(check.source.starts_on, check.source.ends_on)})` : ""}.
      </span>{" "}
      {/* Contests and festivals move more than shifts (registration dates too): "Everything moved". */}
      {contest
        ? `Everything moved ${offsetWords(check.days_moved)} to ${shortRange(event.starts_on, event.ends_on)}, at the same times of day.`
        : summary.shifts > 0
          ? `Every shift moved ${offsetWords(check.days_moved)} to ${shortRange(event.starts_on, event.ends_on)}, at the same times of day.`
          : `It moved ${offsetWords(check.days_moved)} to ${shortRange(event.starts_on, event.ends_on)}.`}
    </>
  );

  // A contest's or festival's registration step: a short line, not the whole note (the deadline sits right below it).
  if (place === "registration") {
    const here = check.newDates.filter((d) => d.step === "registration");
    return (
      <div role="status" className="mt-6 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
        <p>
          {sourceLine}{" "}
          <Link href={base} className={LINK}>
            See what came over
          </Link>
        </p>
        {reg.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {reg.map((l) => (
              <li key={l} className={l.startsWith("The deadline is blank") ? "font-semibold" : undefined}>
                {l}
              </li>
            ))}
          </ul>
        )}
        {/* After the deadline line, in the page's order: each place one linked line. */}
        {here.length > 0 && (
          <ul className="mt-2 space-y-1">
            {here.map((s, i) => (
              <li key={`${s.what}-${s.detail ?? i}`} className="font-medium [overflow-wrap:anywhere]">
                <span aria-hidden className="text-warning">
                  ◆{" "}
                </span>
                <Link href={newDateSpotHref(base, s)} className={LINK}>
                  {s.unmarked ? "Change the old dates in " : "Add the new date in "}
                  {lowerFirst(newDateSpotLabel({ ...s, unmarked: false }))}
                </Link>
                {s.count > 1 && <span className="font-normal text-muted"> · {places(s.count)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div role="status" className="flex gap-2 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
        <LineIcon name="note" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 space-y-2">
          <p>{sourceLine}</p>
          {reg.length > 0 && (
            <ul className="list-disc pl-5">
              {reg.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          {check.newDates.length > 0 && (
            // The full list is in one place: "Not ready to publish yet", below.
            <p className="font-medium text-warning">
              <span aria-hidden>◆ </span>
              {(() => {
                const n = check.newDates.reduce((t, d) => t + d.count, 0);
                return `${places(n)} ${n === 1 ? "needs" : "need"} the new date`;
              })()}{" "}
              (
              <a href="#publish" className={LINK}>
                below
              </a>
              )
            </p>
          )}
          <p className="font-semibold">Check what came over</p>
          <ul className="space-y-1">
            {shown.map((it) => (
              <li key={it.link}>
                <Link href={it.href} className={LINK}>
                  {it.link}
                </Link>{" "}
                <span className="text-muted">· {it.where}</span>
              </li>
            ))}
          </ul>
          {held.length > 0 && (
            <p>
              {held.length === 1 ? `1 Coordinator (${held[0].name}) isn't` : `${held.length} Coordinators aren't`} emailed yet. You choose who&apos;s emailed when
              you publish.{" "}
              <Link href={`${base}/edit?section=team&tab=section-leads`} className={LINK}>
                See them in Team setup
              </Link>
            </p>
          )}
          {sent.length > 0 && <p>Already invited: {listAnd(sent.map((s) => s.name))}. Publishing won&apos;t email them again.</p>}
          {added > 0 && (
            <p>
              {added === 1 ? "1 Coordinator is already on your team, so they keep leading their job." : `${added} Coordinators are already on your team, so they keep leading their jobs.`}
            </p>
          )}
          <p>
            {contest && summary.bands_on_source
              ? `${event.event_type === "group_event" ? "Groups" : "Bands"} and volunteers aren't copied: the ${plural(summary.bands_on_source, event.event_type === "group_event" ? "group" : "band", event.event_type === "group_event" ? "groups" : "bands")} registered stay on ${check.source?.name}.`
              : summary.volunteers_on_source
                ? `Volunteers aren't copied: the ${plural(summary.volunteers_on_source, "volunteer who signed up stays", "volunteers who signed up stay")} on ${check.source?.name}.`
                : "Volunteers aren't copied."}
          </p>
        </div>
      </div>
      {blocker ? (
        <p className="mt-2 text-sm text-muted">{blocker}</p>
      ) : (
        <StartOverButton eventId={event.id} name={event.name} bullets={bullets} />
      )}
    </div>
  );
}

/**
 * "Copied: check it · Details and Jobs and shifts" for the Ready card: the same steps, by the same rule and in the
 * same words, as the step bar and the publish window.
 */
export function CopiedStepsLine({ facts: f, labels }: { facts: CopyFacts; labels: Record<string, string> }): ReactNode {
  const left = f.check.unopened.map((s) => labels[s.step] ?? s.step);
  if (!left.length) return null;
  return (
    <p className="mt-2 text-sm">
      <span className="font-semibold">Copied: check it</span> · {listAnd(left)}
    </p>
  );
}

const lowerFirst = (t: string) => (t ? t[0].toLowerCase() + t.slice(1) : t);
