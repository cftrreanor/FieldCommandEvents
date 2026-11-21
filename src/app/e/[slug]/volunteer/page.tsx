import type { Metadata } from "next";
import { EventHeaderBar, EventHeading } from "@/components/event-brand";
import { loadEventBrand } from "@/lib/event-brand";
import Link from "next/link";
import { Card } from "@/components/ui";
import { missing } from "@/lib/schema-check";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTimeRange, utcToZonedDate, zoneName } from "@/lib/time";
import { signupDay, signupIsOpen, signupOpensAt, signupOpensClock, signupState } from "@/lib/volunteer-signup";
import { RefreshAt } from "@/components/auto-refresh";
import { LineIcon } from "@/components/line-icon";
import { currentSpots, signUpVolunteer } from "./actions";
import { eventPhase, sortStations } from "@/lib/contest-day";
import { hasBooths, leadWords } from "@/lib/event-types";
import { SignupForm, type PublicStation } from "./signup-form";
import { helpLinkSource } from "@/lib/help-link-source";
import { cache, Suspense } from "react";
import { formatTime } from "@/lib/time";
import { confirmWithPass, forgetDevice } from "./actions";
import { ConfirmStep, type ConfirmShift } from "./confirm-step";
import { MoreWays } from "./more-ways";
import type { MoreMode } from "./more-ways-block";
import { loadRemembered, maskEmail, phoneEnding } from "./remembered";

type Params = { params: Promise<{ slug: string }> };

const loadEvent = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, status, event_type, timezone, starts_on, ends_on, venue_name, venue_address, venue_place_id, volunteer_signup_open, volunteer_signup_opens_on, public_notes")
    .eq("slug", slug)
    .maybeSingle();
  return data;
});

/** Whether this event's account keeps a 2-year volunteer history (only packages with volunteer tracking do). */
async function keepsVolunteerHistory(eventId: string) {
  const { data } = await createAdminClient()
    .from("events")
    .select("organizations(plan_tiers(volunteer_history))")
    .eq("id", eventId)
    .maybeSingle();
  const org = data?.organizations as { plan_tiers?: { volunteer_history?: boolean } | null } | null | undefined;
  return org?.plan_tiers?.volunteer_history === true;
}

/**
 * The account's organization page is on (a full shift then points down to "More ways to help", and the page asks
 * search engines not to list it). Once per request: the metadata and the page share it.
 */
const orgPageOn = cache(async (eventId: string) => {
  const { data, error } = await createAdminClient().from("events").select("organizations(org_page_on)").eq("id", eventId).maybeSingle();
  if (error) return false;
  return (data?.organizations as { org_page_on?: boolean } | null | undefined)?.org_page_on === true;
});

/** Who to ask when sign-up is closed: the page's contact, or a reply-to the organizer typed; never a sign-in email. */
async function closedContact(eventId: string) {
  const { data, error } = await createAdminClient().rpc("signup_closed_contact", { p_event: eventId });
  return error ? null : ((data as string | null) ?? null);
}

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  if (!event) return { title: "Volunteer sign-up" };
  // "More ways to help" puts the account's other events on this page, so while it can show, search engines are asked
  // not to list the page (owner, 2026-11-21).
  const block = event.status === "published" && (await orgPageOn(event.id));
  return { title: `Volunteer: ${event.name}`, ...(block ? { robots: { index: false, follow: false } } : {}) };
}

export default async function VolunteerSignupPage({
  params,
  searchParams,
}: Params & {
  searchParams: Promise<{ via?: string | string[]; shift?: string | string[]; fresh?: string | string[]; form?: string | string[]; minor?: string | string[] }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  // Where the visitor came from ("More ways to help" or the organization page), for the names-free count.
  const via = helpLinkSource(query.via);
  const viaShort = via === "more_ways" ? "more" : via === "org_page" ? "org" : null;
  const event = await loadEvent(slug);
  if (!event) missing();

  const supabase = await createClient();
  const [{ data: stations }, { data: shifts }, { data: items }, { data: board }] = await Promise.all([
    supabase
      .from("stations")
      // Every column: showing arrives with the 20270105000000 update.
      .select("*")
      .eq("event_id", event.id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("shifts")
      // Every column: adults_only and min_age arrive with the 20270102000000 update, and the page works without them.
      .select("*")
      .eq("event_id", event.id)
      .gt("ends_at", new Date().toISOString())
      .order("starts_at"),
    supabase.from("station_items").select("id, station_id, name, needed, claimed_count").eq("event_id", event.id).order("sort_order").order("created_at"),
    // Who's bringing what: first names and notes only.
    supabase.rpc("public_item_board", { p_event_id: event.id }),
  ]);
  // Volunteers under 18 come back without a name (20270126000000_item_board_hides_minors.sql).
  const coming = ((board ?? []) as { item_id: string; first_name: string | null; note: string | null }[]).map((c) => ({
    ...c,
    first_name: c.first_name ?? "someone",
  }));
  // Only jobs volunteers can sign up for. (Every job shows now; this keeps out any left hidden from before.)
  const showing = (stations ?? []).filter((st) => (st as { showing?: boolean }).showing !== false);

  const tz = event.timezone;
  const multiDay = event.starts_on !== event.ends_on;
  // Spots saved for adults that each shift still needs (counts only; after the 20270110000000 update).
  const { data: needRows } = await supabase.rpc("shift_adult_needs", { p_event_id: event.id });
  const adultsNeeded = new Map(((needRows ?? []) as { shift_id: string; adults_needed: number }[]).map((r) => [r.shift_id, r.adults_needed]));
  // Check-in stations first, in the host's order: they matter most on the day.
  const publicStations: PublicStation[] = sortStations(showing)
    .map((st) => ({
      // Only what the form shows (the query reads every column).
      id: st.id,
      name: st.name,
      // A volunteer event's jobs meet at the event's address: a place saved before that changed stays out of sight.
      location: event.event_type === "volunteer" ? null : st.location,
      instructions: st.instructions,
      adults_only: st.adults_only,
      // An items station takes things to bring, never time slots.
      shifts: (st.signup_kind === "items" ? [] : (shifts ?? []))
        .filter((s) => s.station_id === st.id)
        .map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          when: `${multiDay ? `${formatDate(utcToZonedDate(s.starts_at, tz), { year: undefined })} · ` : ""}${formatTimeRange(s.starts_at, s.ends_at, tz)}`,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          spotsLeft: s.max_capacity - s.registered_count,
          adultsOnly: st.adults_only || Boolean((s as { adults_only?: boolean }).adults_only),
          minAge: (s as { min_age?: number | null }).min_age ?? null,
          adultsNeeded: adultsNeeded.get(s.id) ?? 0,
        })),
      items: (items ?? [])
        .filter((i) => i.station_id === st.id)
        .map((i) => ({
          id: i.id,
          name: i.name,
          left: i.needed - i.claimed_count,
          needed: i.needed,
          coming: coming.filter((c) => c.item_id === i.id).map((c) => (c.note ? `${c.first_name} (${c.note})` : c.first_name)),
        })),
    }))
    .filter((st) => st.shifts.length > 0 || st.items.length > 0);

  // On fair day, volunteers who show up are added at the volunteer desk instead.
  const fairDay = hasBooths(event.event_type) && eventPhase(event, new Date()) === "day";
  const isOpen = signupIsOpen(event) && !fairDay;
  // Switched on and waiting for its day (in the event's time zone): the page says when.
  const opensOn = !fairDay && signupState(event) === "later" ? event.volunteer_signup_opens_on! : null;
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: event.venue_address,
    ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
  })}`;

  // Every shift (and thing to bring) taken: the page leads with "More ways to help" instead of a form.
  const allTaken =
    publicStations.length > 0 &&
    publicStations.every((st) => st.shifts.every((sh) => sh.spotsLeft <= 0) && st.items.every((it) => it.left <= 0));
  const published = event.status === "published";
  const closed = published && !isOpen && !opensOn;
  const mode: MoreMode = closed ? "closed" : isOpen && allTaken ? "full" : "open";
  const [keepsHistory, pageOn, contact] = await Promise.all([
    keepsVolunteerHistory(event.id),
    published ? orgPageOn(event.id) : false,
    closed && !fairDay ? closedContact(event.id) : null,
  ]);
  const more = published ? (
    <Suspense fallback={null}>
      <MoreWays eventId={event.id} mode={mode} />
    </Suspense>
  ) : null;

  // The confirm step: another event's "More ways to help" (or the organization page) chose a shift here. Never a
  // shift already under way.
  const now = new Date();
  const shiftList: ConfirmShift[] = publicStations.flatMap((st) =>
    st.shifts.filter((sh) => new Date(sh.startsAt) > now).map((sh) => ({
      id: sh.id,
      job: st.name,
      when: `${formatDate(utcToZonedDate(sh.startsAt, tz), { year: undefined })} · ${formatTimeRange(sh.startsAt, sh.endsAt, tz)}`,
      clock: formatTime(sh.startsAt, tz),
      spotsLeft: sh.spotsLeft,
      startsAt: sh.startsAt,
    })),
  );
  const wanted = viaShort && isOpen && isUuid(query.shift) ? shiftList.find((sh) => sh.id === query.shift) : undefined;
  const fresh = query.fresh === "1";
  // "Under 18? Use the full sign-up form" (and "Use different details" from there): the full form, shift ticked.
  const fullForm = query.form === "full";
  const remembered = viaShort && !fresh ? await loadRemembered(event.id) : null;
  // Under-18s (and anyone adding people) use the full form, with the shift ticked.
  const confirmStep = wanted && !remembered?.minor && !fullForm;
  const stepHref = (extra: Record<string, string>) => `/e/${slug}/volunteer?${new URLSearchParams({ ...(wanted ? { shift: wanted.id } : {}), via: viaShort ?? "", ...extra })}`;

  // With the account's color, the event name sits on a full-width band of it. The confirm step's band is short, so
  // its button shows without scrolling on a phone.
  const band = !!(await loadEventBrand(slug)).color;
  const heading = confirmStep ? (
    <EventHeading band={band} title={event.name} compact>
      <p className="mt-1 text-sm text-muted">
        {formatDateRange(event.starts_on, event.ends_on)} · {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}
      </p>
    </EventHeading>
  ) : (
    <EventHeading band={band} eyebrow="Volunteer sign-up" title={event.name}>
      <p className="mt-2 text-muted">
        {formatDateRange(event.starts_on, event.ends_on)} · All times {zoneName(tz)}
      </p>
      <p className="mt-1 text-muted">
        {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")} ·{" "}
        <a href={mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
          Map
        </a>
      </p>
      {event.public_notes && <p className="mt-4 leading-7">{event.public_notes}</p>}
    </EventHeading>
  );

  const alreadySigned = (
    <p className="mt-10 text-center text-sm text-muted">
      Already signed up?{" "}
      <Link href="/my" className="font-medium text-brand underline-offset-4 hover:underline">
        Go to My volunteering
      </Link>
    </p>
  );

  if (confirmStep && wanted) {
    return (
      <>
        <EventHeaderBar slug={slug} />
        {band && heading}
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 sm:py-10">
          {!band && heading}
          <div className={band ? "" : "mt-5"}>
            <ConfirmStep
              action={confirmWithPass.bind(null, event.id)}
              forget={forgetDevice}
              shift={wanted}
              shifts={shiftList}
              remembered={
                remembered
                  ? {
                      name: remembered.fullName,
                      email: maskEmail(remembered.email),
                      phoneEnding: phoneEnding(remembered.phone),
                      from: remembered.eventId === event.id ? null : remembered.eventName,
                    }
                  : null
              }
              needs={{ name: !remembered, email: !remembered, phone: !remembered?.phone }}
              via={viaShort!}
              keepsHistory={keepsHistory}
              eventName={event.name}
              pickHref={`/e/${slug}/volunteer?via=${viaShort}`}
              underHref={stepHref({ form: "full", minor: "1", fresh: "1" })}
              differentHref={stepHref({ fresh: "1" })}
              backHref={stepHref({})}
              startsFull={wanted.spotsLeft <= 0}
              more={more}
            />
          </div>
        </main>
      </>
    );
  }

  const topNote = (title: string, body: React.ReactNode) => (
    <Card className="mt-8 bg-brand-soft">
      <p className="font-medium">{title}</p>
      {body && <div className="mt-1 text-sm leading-6">{body}</div>}
    </Card>
  );

  return (
    <>
    <EventHeaderBar slug={slug} />
    {band && heading}
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
      {!band && heading}

      {opensOn && (
        <Card className="mt-8 border-2 border-brand">
          <p className="text-lg font-semibold">
            <LineIcon name="calendar" inline />
            Volunteer sign-up opens {signupDay(opensOn)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Opens at {signupOpensClock(tz)}, the start of {signupDay(opensOn)}. You can look over the shifts now.
          </p>
          {/* A calendar file for the opening day, linking back here (nothing is emailed). */}
          <a
            href={`/e/${slug}/volunteer/opens`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4"
          >
            Add a reminder to my calendar
          </a>
          <RefreshAt at={signupOpensAt(opensOn, tz).toISOString()} />
        </Card>
      )}
      {!published &&
        topNote(
          "Preview: this page isn't public yet.",
          <p className="text-muted">Only your team can see it. Publish the event and open volunteer sign-up to start taking sign-ups.</p>,
        )}
      {closed &&
        topNote(
          fairDay ? "Online sign-up is closed on fair day." : "Volunteer sign-up is closed.",
          fairDay ? (
            <p>Want to help today? Find the volunteer desk at the fair, and they&apos;ll add you to a shift.</p>
          ) : contact ? (
            <p>
              Questions? Email the organizer at{" "}
              <a href={`mailto:${contact}`} className="font-semibold text-brand underline underline-offset-4 [overflow-wrap:anywhere]">
                {contact}
              </a>
            </p>
          ) : null,
        )}
      {mode === "full" && topNote("Every shift is full.", <p>Thank you to everyone who signed up.</p>)}

      {mode !== "open" ? (
        // Full or closed: "More ways to help" right under the note; this event's shifts read-only behind a disclosure.
        <>
          {more}
          {publicStations.length > 0 && <ClosedShifts stations={publicStations} />}
        </>
      ) : (
        <div className="mt-8">
          {publicStations.length === 0 ? (
            <>
              <Card>
                <p className="text-muted">Nothing is open for sign-up right now.</p>
              </Card>
              {more}
            </>
          ) : (
            <SignupForm
              action={signUpVolunteer.bind(null, event.id)}
              spots={currentSpots.bind(null, event.id)}
              stations={publicStations}
              disabled={!isOpen}
              opensOn={opensOn ? signupDay(opensOn) : undefined}
              lead={leadWords(event.event_type).one}
              keepsHistory={keepsHistory}
              via={via === "direct" ? undefined : via}
              more={more}
              moreBelow={pageOn}
              initialShift={wanted?.id}
              // Remembered details fill in the form from these links (name and email, and "Phone ending 0142": the
              // number stays on the server, which reads it again when the form is sent).
              prefill={
                remembered && !remembered.minor
                  ? {
                      name: remembered.fullName,
                      email: remembered.email,
                      phoneEnding: phoneEnding(remembered.phone),
                      differentHref: stepHref({ fresh: "1", ...(fullForm ? { form: "full" } : {}) }),
                    }
                  : undefined
              }
              startMinor={fullForm && query.minor === "1"}
              footer={alreadySigned}
            />
          )}
        </div>
      )}

      {(mode !== "open" || publicStations.length === 0) && alreadySigned}
    </main>
    </>
  );
}

/** Full or closed: this event's shifts and things to bring, read-only, behind "See the shifts". */
function ClosedShifts({ stations }: { stations: PublicStation[] }) {
  return (
    <details className="group mt-10 rounded-lg border border-border bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex-1">See the shifts</span>
        <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        {stations.map((st) => (
          <div key={st.id}>
            <h3 className="font-semibold">{st.name}</h3>
            <ul className="mt-2 space-y-2">
              {st.shifts.map((s) => (
                <li key={s.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.when}</span>
                    <span className="block text-sm text-muted">{s.title}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium">{s.spotsLeft <= 0 ? "Full" : `${s.spotsLeft} left`}</span>
                </li>
              ))}
              {st.items.map((it) => (
                <li key={it.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span className="min-w-0 flex-1 font-medium">{it.name}</span>
                  <span className="shrink-0 text-sm font-medium">{it.left <= 0 ? "Covered" : `${it.left} of ${it.needed} still needed`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
