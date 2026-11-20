import Link from "next/link";
import type { ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import { requireUser } from "@/lib/auth";
import { loadCopyPublishCheck, type CopyPublishCheck, type DuplicateSummary } from "@/lib/duplicate-event";
import { addDays, firstName, listAnd, offsetWords, plural, shortRange } from "@/lib/duplicate-words";
import { loadAccountHost } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedTime } from "@/lib/time";
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
};

/** A duplicated event's facts for its note and publish window; null for any other event (or before the update). */
export async function loadCopyFacts(eventId: string): Promise<CopyFacts | null> {
  const check = await loadCopyPublishCheck(eventId);
  if (!check) return null;
  const supabase = await createClient();
  const [{ data: copy }, { data: event }, { data: shifts }, { count: files }] = await Promise.all([
    supabase.from("event_copies").select("summary").eq("event_id", eventId).maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_type, status, organization_id, timezone, starts_on, ends_on, window_start, window_end, payment_link, meals_offered, meal_price_cents")
      .eq("id", eventId)
      .maybeSingle(),
    supabase.from("shifts").select("starts_at, ends_at").eq("event_id", eventId),
    supabase.from("event_files").select("id", { count: "exact", head: true }).eq("event_id", eventId),
  ]);
  if (!copy || !event) return null;
  const tz = event.timezone || "America/Chicago";
  const open = utcToZonedTime(event.window_start, tz).slice(0, 5);
  const close = utcToZonedTime(event.window_end, tz).slice(0, 5);
  const shiftsOutside = ((shifts ?? []) as { starts_at: string; ends_at: string }[]).filter(
    (s) => utcToZonedTime(s.starts_at, tz).slice(0, 5) < open || utcToZonedTime(s.ends_at, tz).slice(0, 5) > close,
  ).length;
  return { check, summary: copy.summary as DuplicateSummary, event: event as CopyFacts["event"], shiftsOutside, files: files ?? 0 };
}

const LINK = "font-semibold text-brand underline underline-offset-4";

/** "Sep 25 would have moved to Dec 18, 2026, which has passed": what happened to each registration date. */
export function registrationLines(f: CopyFacts, place: "here" | "elsewhere"): string[] {
  const r = f.summary.registration;
  if (!r) return [];
  const where = place === "here" ? "below" : `on ${f.event.event_type === "group_event" ? "Registration" : "Band registration"}`;
  const would = (was: string | null) => (was ? formatDate(addDays(was, f.check.days_moved)) : null);
  return [
    r.deadline_left_blank
      ? `The registration deadline would have been ${would(r.deadline_was)}, which has passed, so it's blank. Pick a new one ${where}`
      : r.deadline
        ? `The registration deadline moved to ${formatDate(r.deadline)}`
        : null,
    r.opens_on_left_blank
      ? `Registration opens would have been ${would(r.opens_on_was)}, so it's blank: registration opens when you publish`
      : r.opens_on
        ? `Registration opens ${formatDate(r.opens_on)}`
        : null,
  ].filter((x): x is string => Boolean(x));
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
  const old = (area: string) => check.oldDates[area] ?? [];
  const mentions = (area: string) => {
    const found = old(area);
    return found.length ? `it mentions ${listAnd(found.slice(0, 3).map((d) => `“${d.text}”`))}` : null;
  };
  const items: { href: string; link: string; where: string }[] = contest
    ? [
        { href: `${base}/bands`, link: "The fee and dates in the information for directors", where: mentions("registration") ?? regName },
        ...(event.payment_link ? [{ href: `${base}/bands`, link: "The payment link", where: regName }] : []),
        ...(event.meals_offered
          ? [{ href: `${base}/bands`, link: "The meal price", where: event.meal_price_cents != null ? `$${(event.meal_price_cents / 100).toFixed(event.meal_price_cents % 100 ? 2 : 0)}, ${regName}` : regName }]
          : []),
        ...(f.shiftsOutside
          ? [{ href: `${base}/volunteering`, link: `${plural(f.shiftsOutside, "shift", "shifts")} outside the ${event.event_type === "band_contest" ? "contest's" : "festival's"} hours`, where: "Jobs and shifts" }]
          : []),
        { href: `${base}/edit`, link: "The description, and the dates in it", where: mentions("details") ?? "Details" },
        ...(f.files ? [{ href: `${base}/edit?section=files`, link: "Maps and documents", where: `${plural(f.files, "file", "files")} came over` }] : []),
        { href: `${base}/edit?section=emails`, link: "Where replies go, and who gets notified", where: "Email settings, not copied" },
      ]
    : [
        { href: `${base}/edit`, link: "The description, and the dates in it", where: mentions("details") ?? "Details" },
        ...(old("jobs").length ? [{ href: `${base}/volunteering`, link: "Job instructions and shift notes", where: mentions("jobs")! }] : []),
        ...(f.files ? [{ href: `${base}/edit?section=files`, link: "Maps and documents", where: `${plural(f.files, "file", "files")} came over` }] : []),
        { href: `${base}/edit?section=emails`, link: "Where replies go", where: "Email settings, not copied" },
        { href: `${base}/edit?section=emails`, link: "Who gets notified", where: "Email settings, not copied" },
      ];
  // On Band registration, its own items say "below".
  const shown = place === "registration" ? items.map((i) => (i.href === `${base}/bands` ? { ...i, where: i.where === regName ? "below" : i.where } : i)) : items;

  const held = check.invitations.filter((i) => i.status === "held" || i.status === "expired");
  const sent = check.invitations.filter((i) => i.status === "sent");
  const added = summary.coordinators?.added ?? [];
  const reg = registrationLines(f, place === "registration" ? "here" : "elsewhere");
  const user = await requireUser();
  const supabase = await createClient();
  const me = check.discard_blocker ? await loadAccountHost(supabase, event.organization_id, user.id) : null;
  // Reader-specific: the Account Host is told where they can delete it, not to ask themselves.
  const blocker = check.discard_blocker && me?.isMe ? check.discard_blocker.replace("The Account Host can delete it in Event settings.", "You can delete it in Event settings, Publishing and more.") : check.discard_blocker;
  const edited = check.steps.filter((s) => s.confirmed).length > 0;
  const bullets = [
    `Deletes this copy: ${listAnd(
      [
        summary.jobs ? plural(summary.jobs, "job", "jobs") : "",
        summary.shifts ? plural(summary.shifts, "shift", "shifts") : "",
        summary.items ? plural(summary.items, "thing to bring", "things to bring") : "",
        summary.rooms ? plural(summary.rooms, "room", "rooms") : "",
        f.files ? plural(f.files, "file", "files") : "",
      ].filter(Boolean),
    ) || "its details"}`,
    ...(edited ? ["Your changes since duplicating go too"] : []),
    ...(sent.length
      ? sent.map(
          (s) =>
            `${s.name}'s invitation, sent ${s.sent_at ? formatDate(s.sent_at.slice(0, 10), { weekday: undefined, year: undefined }) : "already"}, stops working: if ${firstName(s.name)} opens it, it says it wasn't found. Nobody is emailed`,
        )
      : [`It was never published, and nobody was emailed${held.length ? `, including the ${plural(held.length, "Coordinator", "Coordinators")}` : ""}`]),
    `${check.source?.name ?? "The event you duplicated"} doesn't change`,
    "You go back to Duplicate event, with the name and first day kept",
  ];

  return (
    <div className="mt-6">
      <div role="status" className="flex gap-2 rounded-lg border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
        <LineIcon name="note" className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 space-y-2">
          <p>
            <span className="font-semibold">
              Copied from {check.source?.name ?? "an earlier event"}
              {check.source ? ` (${shortRange(check.source.starts_on, check.source.ends_on)})` : ""}.
            </span>{" "}
            {summary.shifts > 0
              ? `Every shift moved ${offsetWords(check.days_moved)} to ${shortRange(event.starts_on, event.ends_on)}, at the same times of day.`
              : `It moved ${offsetWords(check.days_moved)} to ${shortRange(event.starts_on, event.ends_on)}.`}
            {place === "registration" && contest && summary.jobs > 0 && ` Its ${plural(summary.jobs, "volunteer job is", "volunteer jobs are")} on the ${event.event_type === "group_event" ? "Volunteers" : "Jobs and shifts"} step.`}
          </p>
          {reg.length > 0 && (
            <ul className="list-disc pl-5">
              {reg.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
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
          {added.length > 0 && <p>On your account, so already leading their jobs: {listAnd(added.map((a) => `${a.name} (${a.job})`))}.</p>}
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

/** "Before you publish, check the copied steps: Details and Jobs and shifts." for the Ready card. */
export function CopiedStepsLine({ facts: f, labels }: { facts: CopyFacts; labels: Record<string, string> }): ReactNode {
  const left = f.check.steps.filter((s) => !s.confirmed).map((s) => labels[s.step] ?? s.step);
  if (!left.length) return null;
  return (
    <p className="mt-2 text-sm">
      Before you publish, check the copied {left.length === 1 ? "step" : "steps"}:{" "}
      {left.map((l, i) => (
        <span key={l}>
          {i > 0 && (i === left.length - 1 ? (left.length > 2 ? ", and " : " and ") : ", ")}
          <span className="font-semibold">{l}</span>
        </span>
      ))}
      .
    </p>
  );
}
