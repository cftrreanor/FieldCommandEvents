import type { Metadata } from "next";
import { EventHeaderBar, EventHeading } from "@/components/event-brand";
import { loadEventBrand } from "@/lib/event-brand";
import Link from "next/link";
import { Card } from "@/components/ui";
import { missing } from "@/lib/schema-check";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTimeRange, utcToZonedDate, zoneName } from "@/lib/time";
import { currentSpots, signUpVolunteer } from "./actions";
import { eventPhase, sortStations } from "@/lib/contest-day";
import { hasBooths, leadWords } from "@/lib/event-types";
import { SignupForm, type PublicStation } from "./signup-form";

type Params = { params: Promise<{ slug: string }> };

async function loadEvent(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, status, event_type, timezone, starts_on, ends_on, venue_name, venue_address, venue_place_id, volunteer_signup_open, public_notes")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

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

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  return { title: event ? `Volunteer: ${event.name}` : "Volunteer sign-up" };
}

export default async function VolunteerSignupPage({ params }: Params) {
  const { slug } = await params;
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
  const isOpen = event.status === "published" && event.volunteer_signup_open && !fairDay;
  const mapUrl = `https://www.google.com/maps/search/?${new URLSearchParams({
    api: "1",
    query: event.venue_address,
    ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
  })}`;

  // With the account's color, the event name sits on a full-width band of it.
  const band = !!(await loadEventBrand(slug)).color;
  const heading = (
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

  return (
    <>
    <EventHeaderBar slug={slug} />
    {band && heading}
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
      {!band && heading}

      {!isOpen && (
        <Card className="mt-8 bg-brand-soft">
          <p className="font-medium">
            {fairDay
              ? "Online sign-up is closed on fair day."
              : event.status === "published"
                ? "Volunteer sign-up is closed."
                : "Preview: this page isn't public yet."}
          </p>
          <p className="mt-1 text-sm text-muted">
            {fairDay
              ? "Want to help today? Find the volunteer desk at the fair, and they'll add you to a shift."
              : event.status === "published"
                ? "Please contact the event organizers if you'd like to help."
              : "Only your team can see it. Publish the event and open volunteer sign-up to start taking sign-ups."}
          </p>
        </Card>
      )}

      <div className="mt-8">
        {publicStations.length === 0 ? (
          <Card>
            <p className="text-muted">Nothing is open for sign-up right now.</p>
          </Card>
        ) : (
          <SignupForm
            action={signUpVolunteer.bind(null, event.id)}
            spots={currentSpots.bind(null, event.id)}
            stations={publicStations}
            disabled={!isOpen}
            lead={leadWords(event.event_type).one}
            keepsHistory={await keepsVolunteerHistory(event.id)}
          />
        )}
      </div>

      <p className="mt-10 text-center text-sm text-muted">
        Already signed up?{" "}
        <Link href="/my" className="font-medium text-brand underline-offset-4 hover:underline">
          Go to My volunteering
        </Link>
      </p>
    </main>
    </>
  );
}
