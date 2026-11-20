import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getMyOrganization } from "@/lib/data";
import { isPlacesConfigured } from "@/lib/places";
import { createEvent } from "../../actions";
import { EventForm } from "../_components/event-form";
import { SetupHeader } from "../_components/setup-steps";
import { SetupSteps } from "@/components/volunteer-steps";
import { sponsorsEnabled } from "@/lib/sponsors-data";
import type { StepsKind } from "@/lib/setup-steps";
import { SetupLogo } from "../_components/setup-logo";
import { StartFromEvent, type PastEvent } from "../_components/start-from-event";
import { canDuplicateKind, listAnd, longRange, plural } from "@/lib/duplicate-words";
import { loadBrand } from "@/lib/badges";
import { EventTypeChoices } from "@/components/event-type-picker";
import { hasConferences, isEventType } from "@/lib/event-types";
import { endedSentence, loadAccountHost, loadAccountPlan, pickerGroups, planEnded, startableTypes, typeNotes, typeWords } from "@/lib/plan";
import { freeStatus } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import { PlanAsk } from "@/components/plan-ask";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: PageProps<"/dashboard/events/new">) {
  const org = await getMyOrganization();
  if (!org) redirect("/dashboard");
  const { type, on } = await searchParams;
  // The plan's own kinds come first in the picker; any other kind can be set up to try.
  // Before the packages update, teacher accounts host conferences only.
  const supabase = await createClient();
  const plan = await loadAccountPlan(supabase, org.id);
  const included = plan ? startableTypes(plan) : org.account_kind === "teacher" ? ["conference"] : undefined;
  const trial = isEventType(type) && included && !included.includes(type) ? type : null;
  // No kind picked yet (e.g. a bookmarked link): ask first.
  if (!isEventType(type)) {
    const { data: published } = plan
      ? await supabase.from("events").select("name, event_type, status, starts_on, ends_on, timezone").eq("organization_id", org.id).eq("status", "published")
      : { data: null };
    const ended = endedSentence(plan, freeStatus(org), org.subscription_status);
    return (
      <div className="mx-auto max-w-2xl">
        <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
          ← My events
        </Link>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">What kind of event is this?</h1>
        <div className="mt-8">
          <EventTypeChoices
            included={included}
            notes={plan ? typeNotes(plan, published ?? []) : undefined}
            lead={plan && planEnded(plan) ? "conference" : undefined}
            groups={pickerGroups(plan, included, ended)}
          />
        </div>
      </div>
    );
  }

  const changeKind = (
    <Link href="/dashboard/events/new" className="font-medium text-brand underline-offset-4 hover:underline">
      Change the kind of event
    </Link>
  );
  // A kind the plan doesn't include: say so up front, before any work goes in.
  // A kind the plan doesn't include: say so up front, before any work goes in, with who to ask for a plan.
  const user = trial ? await requireUser() : null;
  const host = user ? await loadAccountHost(supabase, org.id, user.id) : null;
  const trialNote = trial && (
    <div role="note" className="mt-4 flex gap-3 rounded-md border border-brand/25 bg-brand-soft px-4 py-3 text-sm leading-6">
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 size-5 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
      <div className="space-y-2">
        <p>
          <strong>You&apos;re trying {typeWords(trial)}.</strong> Set it up and preview it as much as you like. While you&apos;re trying it,
          emails go only to people on your {org.name} account. Publishing it, or inviting partners, volunteers, or families, needs a plan
          that includes {typeWords(trial)}.
        </p>
        {host && (
          <p>
            <PlanAsk host={host} orgName={org.name} kind={typeWords(trial)} />
          </p>
        )}
        <p>
          <Link href="/dashboard/account" className="font-medium text-brand underline underline-offset-4">
            See your plan
          </Link>
        </p>
      </div>
    </div>
  );

  // Most events: the first of the guided setup's steps (the rest are in Event settings, ?setup=1).
  if (!hasConferences(type)) {
    // The account's logo and color, for an Account Host to set from the start.
    const { data: isAdmin } = await supabase.rpc("is_org_admin", { org: org.id });
    const brand = isAdmin ? await loadBrand(org.id) : null;
    // Start from one of your events (Duplicate event, 2026-11-20): this kind's events on the account, for the
    // Account Host and Co-hosts of every event. Replaces "Start from a previous contest" and the festival copy.
    const past = isAdmin && canDuplicateKind(type) ? await pastEvents(supabase, org.id, type) : [];
    // A date already typed before (or kept from starting over) stays.
    const day = typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined;
    return (
      <div className="mx-auto max-w-5xl" data-required-marks>
        {type === "volunteer" || type === "band_contest" || type === "group_event" ? (
          <FirstStep
            kind={type === "volunteer" ? "volunteer" : type === "group_event" ? "festival" : "band"}
            sponsorsOn={type !== "volunteer" && (await sponsorsEnabled(org.id))}
            intro={
              type === "volunteer"
                ? "Add your team, maps, and volunteer jobs whenever you're ready, from Event settings."
                : type === "group_event"
                  ? "What families and group directors see first. You can change any of it later."
                  : "Add your team and maps whenever you're ready, from Event settings."
            }
          >
            {changeKind}
          </FirstStep>
        ) : (
          <SetupHeader current="details" back={{ href: "/dashboard", label: "My events" }}>
            {changeKind}
          </SetupHeader>
        )}
        {trialNote}
        {past.length > 0 && <StartFromEvent events={past} kindWords={KIND_WORDS[type] ?? "an event"} />}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">Event details</h2>
          <p className="mt-1 text-sm text-muted">The name, dates, times, and venue everyone sees.</p>
          <div className="mt-4">
            <EventForm
              action={createEvent}
              organizationId={org.id}
              eventType={type}
              initial={{ timezone: org.default_timezone, startsOn: day, endsOn: day }}
              venueSearchEnabled={isPlacesConfigured}
              submitLabel="Save and continue"
              setup={{}}
              extra={brand && <SetupLogo eventId={null} logo={brand.logo} color={brand.color} />}
            />
          </div>
        </Card>
      </div>
    );
  }

  // Meetings and conferences: step 1 of the same five steps shown on their pages once the event exists, so
  // this form reads as the start of setup, not all of it (owner, QA 2026-11-08).
  return (
    <div className="mx-auto max-w-5xl" data-required-marks>
      <FirstStep kind="meeting" intro={`${type === "conference" ? "Free for teachers. " : ""}Next, you'll set your hours and where you'll meet.`}>
        {changeKind}
      </FirstStep>
      {trialNote}
      <Card className="mt-6">
        <h2 className="text-lg font-semibold">Event details</h2>
        <p className="mt-1 text-sm text-muted">The name and time zone everyone sees.</p>
        <div className="mt-4">
          <EventForm
            action={createEvent}
            organizationId={org.id}
            eventType={type}
            initial={{ timezone: org.default_timezone }}
            venueSearchEnabled={isPlacesConfigured}
            submitLabel="Save and continue"
            setup={{}}
          />
        </div>
      </Card>
    </div>
  );
}

/**
 * Step 1 of a volunteer event, band contest, or meetings event, before it exists: the same step bar,
 * back link, and title as its later steps, so this form reads as the start of setup, not all of it
 * (owner and light check, 2026-11-08).
 */
function FirstStep({ kind, intro, children, sponsorsOn = false }: { kind: StepsKind; intro: string; children: ReactNode; sponsorsOn?: boolean }) {
  return (
    <>
      <SetupSteps eventId="" kind={kind} facts={{ middleDone: false, middleNote: null, count: null, sponsorsOn }} preview />
      <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">
        ← My events
      </Link>
      <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">Event details</h1>
      <p className="mt-2 max-w-3xl text-muted">
        {intro} Boxes marked * are required. {children}
      </p>
    </>
  );
}

const KIND_WORDS: Record<string, string> = {
  volunteer: "a volunteer event",
  fair: "a school fair",
  band_contest: "a band contest",
  group_event: "a festival",
};

/** This kind's events on the account, newest first, each with what it would bring over. A draft with no jobs has nothing to copy. */
async function pastEvents(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, type: string): Promise<PastEvent[]> {
  const { data } = await supabase
    .from("events")
    .select("id, name, status, starts_on, ends_on, venue_name")
    .eq("organization_id", orgId)
    .eq("event_type", type)
    .order("starts_on", { ascending: false })
    .limit(30);
  const events = (data ?? []) as { id: string; name: string; status: string; starts_on: string; ends_on: string; venue_name: string | null }[];
  if (!events.length) return [];
  const ids = events.map((e) => e.id);
  const [{ data: stations }, { data: shifts }, { data: items }, { data: files }, { data: leads }] = await Promise.all([
    supabase.from("stations").select("event_id").in("event_id", ids),
    supabase.from("shifts").select("event_id").in("event_id", ids),
    supabase.from("station_items").select("event_id").in("event_id", ids),
    supabase.from("event_files").select("event_id").in("event_id", ids),
    supabase.from("station_leads").select("event_id, user_id").in("event_id", ids),
  ]);
  const n = (rows: { event_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.event_id === id).length;
  return events
    .map((e) => {
      const jobs = n(stations, e.id);
      const coordinators = new Set((leads ?? []).filter((l) => l.event_id === e.id).map((l) => l.user_id)).size;
      const parts = [
        type === "band_contest" || type === "group_event" ? "registration setup" : "",
        jobs ? plural(jobs, "job", "jobs") : "",
        n(shifts, e.id) ? plural(n(shifts, e.id), "shift", "shifts") : "",
        n(items, e.id) ? plural(n(items, e.id), "thing to bring", "things to bring") : "",
        n(files, e.id) ? plural(n(files, e.id), "file", "files") : "",
        coordinators ? plural(coordinators, "Coordinator", "Coordinators") : "",
      ].filter(Boolean);
      return { e, jobs, parts };
    })
    .filter(({ e, jobs }) => e.status !== "draft" || jobs > 0)
    .map(({ e, parts }) => ({
      id: e.id,
      name: e.name,
      date: formatDate(e.starts_on),
      dates: longRange(e.starts_on, e.ends_on),
      venue: e.venue_name,
      summary: parts.length ? `Brings ${listAnd(parts)}` : "Brings its details",
    }));
}
