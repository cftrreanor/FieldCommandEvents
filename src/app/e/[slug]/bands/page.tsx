import type { Metadata } from "next";
import { EventHeaderBar, EventHeading } from "@/components/event-brand";
import { loadEventBrand } from "@/lib/event-brand";
import Link from "next/link";
import { redirect } from "next/navigation";
import { groupWords, hasEnsembles, hasRooms } from "@/lib/event-types";
import { registerAgain, registerBand } from "@/app/dashboard/band-actions";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { BAND_COLUMNS, deadlinePassed, opensLater, registrationIsOpen, type BandRow } from "@/lib/bands";
import { formatPhone } from "@/lib/phone";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateRange, formatTimeRange, zoneAbbreviation } from "@/lib/time";
import { LineIcon } from "@/components/line-icon";
import { GuestRegister } from "./guest-register";
import { loadMealOffer } from "@/lib/meals";
import { RegisterForm, type PreviousBand } from "./register-form";

type Params = { params: Promise<{ slug: string }> };

type Prefill = {
  id: string;
  email: string;
  band_name: string;
  school_name: string | null;
  classification: string | null;
  school_address: string | null;
  contact_email: string | null;
  head_director_name: string | null;
  head_director_phone: string | null;
  assistant_directors: string[];
  student_count: number | null;
  chaperone_count: number | null;
  bus_count: number | null;
  box_truck_count: number | null;
  truck_trailer_count: number | null;
  semi_truck_count: number | null;
  special_needs: string | null;
};

async function loadEvent(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("id, name, status, event_type, starts_on, ends_on, window_start, window_end, venue_name, venue_address, venue_place_id, timezone, band_registration_open, band_registration_deadline, band_registration_opens_on, director_info, chaperone_limit, classifications, payment_link")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  const w = groupWords(event?.event_type);
  return { title: event ? `${w.One} registration: ${event.name}` : "Registration" };
}

export default async function BandRegistrationPage({ params }: Params) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) missing();
  // Only band contests and group events take registrations.
  if (!hasEnsembles(event.event_type)) redirect(`/e/${slug}`);
  // Festivals register at /register (owner, 2026-11-11); old /bands links keep working.
  if (hasRooms(event.event_type)) redirect(`/e/${slug}/register`);
  const w = groupWords(event.event_type);
  const kind = hasRooms(event.event_type) ? "group" : "band";
  const user = await getUser();
  const supabase = await createClient();

  const [{ data: myBandData }, { data: profile }, { data: prefillData }] = user
    ? await Promise.all([
        supabase.from("bands").select(`${BAND_COLUMNS}, events(name, event_type)`).eq("director_user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
        // Details the host imported for this director, from their spreadsheet.
        supabase.rpc("my_band_prefills", { p_event: event.id }),
      ])
    : [{ data: [] }, { data: null }, { data: [] }];
  const myBands = (myBandData ?? []) as unknown as (BandRow & { events: { name: string; event_type: string | null } | null })[];
  const mine = myBands.filter((b) => b.event_id === event.id);
  // The latest registration of each of the director's bands, to copy from.
  // (Not ones already registered for this contest.)
  const seen = new Set<string>(mine.map((b) => `${b.band_name}|${b.school_name}`.toLowerCase()));
  const registeredNames = new Set(mine.map((b) => b.band_name.toLowerCase()));
  const prefilled: PreviousBand[] = ((prefillData ?? []) as Prefill[])
    .filter((p) => !registeredNames.has(p.band_name.toLowerCase()))
    .map((p) => ({
      id: p.id,
      from: "the organizer",
      prefilled: true,
      band_name: p.band_name,
      school_name: p.school_name ?? "",
      classification: p.classification ?? "",
      school_address: p.school_address ?? "",
      contact_email: p.contact_email ?? p.email,
      head_director_name: p.head_director_name ?? profile?.full_name ?? "",
      head_director_email: p.email,
      head_director_phone: formatPhone(p.head_director_phone ?? profile?.phone),
      assistant_directors: p.assistant_directors,
      student_count: p.student_count ?? undefined,
      chaperone_count: p.chaperone_count ?? undefined,
      bus_count: p.bus_count ?? undefined,
      box_truck_count: p.box_truck_count ?? undefined,
      truck_trailer_count: p.truck_trailer_count ?? undefined,
      semi_truck_count: p.semi_truck_count ?? undefined,
      special_needs: p.special_needs,
    }));
  const previous: PreviousBand[] = myBands
    // Groups copy from groups, bands from bands.
    .filter((b) => hasRooms(b.events?.event_type) === hasRooms(event.event_type))
    // Not ones whose details were removed 2 years after their event (purge_band_directors).
    .filter((b) => b.head_director_email)
    .filter((b) => {
      const k = `${b.band_name}|${b.school_name}`.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((b) => ({
      ...b,
      head_director_phone: formatPhone(b.head_director_phone),
      from: b.events?.name ?? "an earlier event",
    }));
  previous.unshift(...prefilled);

  const open = registrationIsOpen(event);
  // Meals the host provides, if any (the form asks how many).
  const meals = await loadMealOffer(supabase, event.id);
  // Published with registration set to open on a later day: say when.
  const later = event.status === "published" && event.band_registration_open && opensLater(event);
  const here = `/e/${slug}/bands`;
  const form = user && (
    <RegisterForm
      action={registerBand.bind(null, event.id)}
      again={registerAgain.bind(null, event.id)}
      classifications={event.classifications}
      chaperoneLimit={event.chaperone_limit}
      meals={meals}
      previous={previous}
      kind={kind}
      blank={{
        head_director_name: profile?.full_name ?? "",
        head_director_email: user.email,
        head_director_phone: formatPhone(profile?.phone),
        contact_email: user.email,
      }}
    />
  );

  // With the account's color, the event name sits on a full-width band of it.
  const band = !!(await loadEventBrand(slug)).color;
  const mapUrl = event.venue_address
    ? `https://www.google.com/maps/search/?${new URLSearchParams({
        api: "1",
        query: event.venue_address,
        ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
      })}`
    : null;
  const heading = (
    <EventHeading band={band} eyebrow={`${w.One} registration`} title={event.name}>
      <p className="mt-2 text-muted">
        {event.starts_on === event.ends_on && event.window_start && event.window_end
          ? `${formatDate(event.starts_on)} · ${formatTimeRange(event.window_start, event.window_end, event.timezone)}`
          : formatDateRange(event.starts_on, event.ends_on)}
      </p>
      {(event.venue_name || event.venue_address) && (
        <p className="mt-1 text-muted">
          {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}
          {mapUrl && (
            <>
              {" "}
              ·{" "}
              <a href={mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
                Directions
              </a>
            </>
          )}
        </p>
      )}
    </EventHeading>
  );
  // How long it takes, and that answers can change later.
  const promise = `It takes about 5 minutes, and you can change your answers ${
    event.band_registration_deadline ? `until the end of ${formatDate(event.band_registration_deadline)}` : "while registration is open"
  }.`;

  return (
    <>
    <EventHeaderBar slug={slug} />
    {band && heading}
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
      {!band && heading}

      {later && (
        // Before it opens, the opening day comes first, with a way to remember it.
        <Card className="mt-8 border-2 border-brand">
          <p className="text-lg font-semibold">
            <LineIcon name="calendar" inline />
            {w.One} registration opens {formatDate(event.band_registration_opens_on!)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Opens at midnight ({zoneAbbreviation(`${event.band_registration_opens_on}T12:00:00Z`, event.timezone)})
            {event.band_registration_deadline ? `. Closes at the end of ${formatDate(event.band_registration_deadline)}` : ""}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/e/${slug}/bands/opens`} className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
              Add to calendar
            </a>
          </div>
        </Card>
      )}

      {(event.director_info || event.payment_link || (open && event.band_registration_deadline)) && (
        <Card className="mt-8 space-y-3">
          {open && event.band_registration_deadline && (
            <p className="font-medium">Registration closes at the end of {formatDate(event.band_registration_deadline)}.</p>
          )}
          {event.director_info && <p className="whitespace-pre-line leading-7">{event.director_info}</p>}
          {event.payment_link && (
            <p>
              <a
                href={event.payment_link}
                target="_blank"
                rel="noopener noreferrer"
                // Until registration opens, paying isn't the next step: an outline button.
                className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold ${open ? "bg-brand text-brand-foreground hover:bg-brand-hover" : "border-[1.5px] border-field-border bg-surface hover:border-brand"}`}
              >
              Pay the entry fee <span className="sr-only">(opens in a new tab)</span>
            </a>
            </p>
          )}
        </Card>
      )}

      {mine.length > 0 && (
        <Card className="mt-8 bg-brand-soft">
          <p className="font-medium">You&apos;ve registered</p>
          <ul className="mt-2 space-y-1">
            {mine.map((b) => (
              <li key={b.id}>
                <Link href={`/dashboard/bands/${b.id}`} className="font-medium text-brand underline-offset-4 hover:underline">
                  {b.band_name} ({b.school_name})
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Open a {w.one} to see your times or change your registration.</p>
        </Card>
      )}

      <div className="mt-8">
        {!open ? (
          <Card>
            <p className="font-medium">
              {event.status !== "published"
                ? "Preview: this page isn't public yet."
                : later
                  ? `Not open yet`
                  : deadlinePassed(event) && event.band_registration_open
                  ? `${w.One} registration closed on ${formatDate(event.band_registration_deadline!)}.`
                  : `${w.One} registration is closed.`}
            </p>
            <p className="mt-1 text-sm text-muted">
              {later
                ? "The form appears here when registration opens."
                : event.status === "published"
                ? mine.length > 0
                  ? `To change your registration now, contact the organizer from your ${w.one}'s page.`
                  : `If you still need to register a ${w.one}, contact the organizer directly.`
                : `Publish the event and open ${w.one} registration to accept registrations.`}
            </p>
            {event.status === "published" && (
              <Link href={`/e/${slug}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-4 hover:underline">
                See the event page
              </Link>
            )}
          </Card>
        ) : !user ? (
          <>
            <p className="mb-2 text-sm text-muted">
              {promise} After you submit, we&apos;ll email the head director a code to confirm, with no password needed.
            </p>
            <p className="mb-6 text-sm">
              Registered with us before?{" "}
              <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-medium text-brand underline-offset-4 hover:underline">
                Sign in to use your saved details
              </Link>
            </p>
            <GuestRegister eventId={event.id} classifications={event.classifications} chaperoneLimit={event.chaperone_limit} kind={kind} meals={meals} />
          </>
        ) : mine.length > 0 ? (
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-background group-open:mb-6">
              + Register another {w.one}
            </summary>
            {form}
          </details>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{promise}</p>
            {form}
          </>
        )}
      </div>
    </main>
    </>
  );
}
