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
import { ContestPicker } from "../_components/contest-picker";
import { FestivalCopy, type PastFestival } from "../_components/festival-copy";
import { loadBrand } from "@/lib/badges";
import { EventTypeChoices } from "@/components/event-type-picker";
import { hasConferences, isEventType } from "@/lib/event-types";
import { endedSentence, loadAccountHost, loadAccountPlan, pickerGroups, planEnded, startableTypes, typeNotes, typeWords } from "@/lib/plan";
import { freeStatus } from "@/lib/admin";
import { requireUser } from "@/lib/auth";
import { PlanAsk } from "@/components/plan-ask";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime } from "@/lib/time";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: PageProps<"/dashboard/events/new">) {
  const org = await getMyOrganization();
  if (!org) redirect("/dashboard");
  const { type, from, on, picked } = await searchParams;
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
    // A band contest can start from any earlier contest on the account (a format that worked well, not just last year's).
    const { data: pastData } =
      type === "band_contest"
        ? await supabase
            .from("events")
            .select("id, name, status, classifications, starts_on, ends_on, timezone, window_start, window_end, venue_name, venue_address, venue_place_id, venue_lat, venue_lng")
            .eq("organization_id", org.id)
            .eq("event_type", "band_contest")
            .order("starts_on", { ascending: false })
            .limit(30)
        : { data: [] };
    const past = ((pastData ?? []) as {
      id: string;
      name: string;
      status: string;
      classifications: string[] | null;
      starts_on: string;
      ends_on: string;
      timezone: string;
      window_start: string;
      window_end: string;
      venue_name: string | null;
      venue_address: string;
      venue_place_id: string | null;
      venue_lat: number | null;
      venue_lng: number | null;
    }[]).filter((e) => e.status !== "draft" || (e.classifications ?? []).length > 0); // a draft never set up has nothing to copy
    const source = past.find((e) => e.id === from) ?? null;
    // A festival can start from an earlier one on the account (copy last year's: owner decisions, 2026-11-11).
    const { data: festivalData } =
      type === "group_event"
        ? await supabase
            .from("events")
            .select("id, name, status, starts_on, timezone")
            .eq("organization_id", org.id)
            .eq("event_type", "group_event")
            .order("starts_on", { ascending: false })
            .limit(30)
        : { data: [] };
    const thisYear = Number(utcToZonedDate(new Date().toISOString(), org.default_timezone).slice(0, 4));
    // A draft never published may be half set up: only festivals that went live, and have started, are offered.
    const pastFestivals: PastFestival[] = ((festivalData ?? []) as { id: string; name: string; status: string; starts_on: string }[])
      .filter((e) => e.status !== "draft" && e.starts_on <= utcToZonedDate(new Date().toISOString(), org.default_timezone))
      .map((e) => {
        const year = Number(e.starts_on.slice(0, 4));
        return {
          id: e.id,
          name: e.name,
          date: formatDate(e.starts_on),
          // "Spring Choir Festival 2026" becomes "… 2027"; a name without a year stays as it is.
          newName: e.name.replace(/\b(20\d\d)\b/, (y) => String(Math.max(Number(y) + 1, thisYear))),
          when: year >= thisYear - 1 ? ("Last year" as const) : ("Last time" as const),
        };
      });
    // A date already typed before picking (or before starting over) stays.
    const day = typeof on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined;
    const pastContest = (e: (typeof past)[number]) => ({ id: e.id, name: e.name, date: formatDate(e.starts_on), venue: e.venue_name });
    // What's copied and what starts fresh, shown as soon as a contest is chosen in the dropdown.
    const copies = (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-semibold">Copied when you save</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      <li>Classifications and information for directors</li>
                      <li>Payment link, chaperone limit, meals, and contact for directors</li>
                      <li>Registration dates, moved by the same number of days as contest day (left blank if that&apos;s in the past)</li>
                      <li>Ready times and equipment spots</li>
                      <li>Volunteer jobs, check-in stops, and things to bring, with shifts at the same times of day</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold">Starts fresh</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      <li>Bands and invitations</li>
                      <li>The performance schedule</li>
                      <li>People who signed up to volunteer, and coordinators</li>
                      <li>Files and maps, email reply settings, and who gets notified</li>
                    </ul>
                  </div>
                </div>
    );
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
        {pastFestivals.length > 0 && <FestivalCopy festivals={pastFestivals} today={utcToZonedDate(new Date().toISOString(), org.default_timezone)} />}
        {past.length > 0 && (
          // Start from an earlier contest: its setup comes over when this one is saved.
          <Card className="mt-6">
            <h2 className="text-lg font-semibold">Start from a previous contest</h2>
            <p className="mt-1 text-sm text-muted">Copy the setup of a contest that worked well, or start from scratch.</p>
            <div className="mt-4">
              <ContestPicker key={source?.id ?? "new"} contests={past.map(pastContest)} current={source ? pastContest(source) : null} copies={copies} />
            </div>
            {source && (
              <>
                <p className="mt-4 text-sm font-semibold">
                  Pick the new contest date below. The name, times, and venue are filled in from {source.name}.
                </p>
              </>
            )}
          </Card>
        )}
        <Card className="mt-6">
          <h2 className="text-lg font-semibold">Event details</h2>
          <p className="mt-1 text-sm text-muted">The name, dates, times, and venue everyone sees.</p>
          <div className="mt-4">
            <EventForm
              action={createEvent}
              organizationId={org.id}
              eventType={type}
              key={source?.id ?? "new"}
              nameHint={source ? "Same name as the contest you're copying. Add the year if it helps tell them apart." : undefined}
              dateHint={source ? `${source.name} was ${formatDateRange(source.starts_on, source.ends_on)}.` : undefined}
              focusDate={Boolean(source && picked)}
              initial={
                source
                  ? {
                      startsOn: day,
                      endsOn: day,
                      name: source.name,
                      timezone: source.timezone,
                      startTime: utcToZonedTime(source.window_start, source.timezone).slice(0, 5),
                      endTime: utcToZonedTime(source.window_end, source.timezone).slice(0, 5),
                      venue: {
                        name: source.venue_name,
                        address: source.venue_address,
                        placeId: source.venue_place_id,
                        lat: source.venue_lat,
                        lng: source.venue_lng,
                      },
                    }
                  : { timezone: org.default_timezone, startsOn: day, endsOn: day }
              }
              venueSearchEnabled={isPlacesConfigured}
              submitLabel="Save and continue"
              setup={{}}
              extra={
                <>
                  {source && <input type="hidden" name="fromEventId" value={source.id} />}
                  {brand && <SetupLogo eventId={null} logo={brand.logo} color={brand.color} />}
                </>
              }
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
