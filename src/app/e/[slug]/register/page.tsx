import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventHeaderBar, EventHeading } from "@/components/event-brand";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { deadlinePassed, opensLater, registrationIsOpen } from "@/lib/bands";
import { loadEventBrand } from "@/lib/event-brand";
import { hasRooms } from "@/lib/event-types";
import { weekday } from "@/lib/rooms";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { eachDate, formatDate, formatDateRange } from "@/lib/time";
import { FestivalForm } from "./festival-form";

type Params = { params: Promise<{ slug: string }> };

async function loadEvent(slug: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select(
      "id, name, status, event_type, starts_on, ends_on, timezone, venue_name, venue_address, venue_place_id, band_registration_open, band_registration_deadline, band_registration_opens_on, director_info, payment_link, chaperone_limit, classifications, ask_chaperones, ask_buses, ask_availability",
    )
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).slug);
  return { title: event ? `Register your group: ${event.name}` : "Registration" };
}

const OUT = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** A festival's group registration page (board 16). Band contests register at /bands. */
export default async function FestivalRegisterPage({ params }: Params) {
  const { slug } = await params;
  const event = await loadEvent(slug);
  if (!event) missing();
  if (!hasRooms(event.event_type)) redirect(`/e/${slug}/bands`);
  const user = await getUser();
  const supabase = await createClient();
  const [{ data: mineData }, { data: full }, { data: prefillData }] = await Promise.all([
    user
      ? supabase.from("bands").select("id, band_name, school_name").eq("event_id", event.id).eq("director_user_id", user.id).order("created_at")
      : Promise.resolve({ data: [] as { id: string; band_name: string; school_name: string }[] }),
    supabase.rpc("group_event_full", { ev: event.id }),
    // Details the organizer imported for this director, from their spreadsheet.
    user ? supabase.rpc("my_band_prefills", { p_event: event.id }) : Promise.resolve({ data: [] }),
  ]);
  const mine = mineData ?? [];
  type Prefill = { band_name: string; school_name: string | null; classification: string | null; student_count: number | null; chaperone_count: number | null; bus_count: number | null };
  const prefill = ((prefillData ?? []) as Prefill[]).find((p) => !mine.some((b) => b.band_name.toLowerCase() === p.band_name.toLowerCase()));
  const open = registrationIsOpen(event);
  const later = event.status === "published" && event.band_registration_open && opensLater(event);
  const deadline = event.band_registration_deadline;
  const band = !!(await loadEventBrand(slug)).color;
  const mapUrl = event.venue_address
    ? `https://www.google.com/maps/search/?${new URLSearchParams({
        api: "1",
        query: event.venue_address,
        ...(event.venue_place_id ? { query_place_id: event.venue_place_id } : {}),
      })}`
    : null;

  const heading = (
    <EventHeading band={band} eyebrow="Register your group" title={event.name}>
      <p className="mt-2 text-muted">
        {formatDateRange(event.starts_on, event.ends_on)}
        {open && deadline ? ` · Registration closes ${formatDate(deadline)}` : ""}
      </p>
      {(event.venue_name || event.venue_address) && (
        <p className="mt-1 text-muted">
          {[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}
          {mapUrl && (
            <>
              {" · "}
              <a href={mapUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
                Get directions
              </a>
            </>
          )}
        </p>
      )}
    </EventHeading>
  );

  return (
    <>
      <EventHeaderBar slug={slug} />
      {band && heading}
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
        {!band && heading}

        {(event.director_info || event.payment_link) && (
          <Card className="mt-8 space-y-3">
            <h2 className="text-lg font-semibold">From the organizer</h2>
            {event.director_info && <p className="whitespace-pre-line text-sm leading-6">{event.director_info}</p>}
            {event.payment_link && (
              <a href={event.payment_link} target="_blank" rel="noopener noreferrer" className={OUT}>
                Pay the entry fee <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </Card>
        )}

        {mine.length > 0 && (
          <Card className="mt-6">
            <h2 className="font-semibold">You&apos;ve registered</h2>
            <ul className="mt-2 space-y-1">
              {mine.map((b) => (
                <li key={b.id}>
                  <Link href={`/dashboard/bands/${b.id}`} className="inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4">
                    {b.band_name} ({b.school_name})
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="mt-8">
          {event.status !== "published" ? (
            <Card>
              <p className="font-medium">Preview: this page isn&apos;t public yet.</p>
              <p className="mt-1 text-sm">Directors can register once you publish the festival.</p>
            </Card>
          ) : later ? (
            <Card>
              <p className="font-medium">Registration opens {formatDate(event.band_registration_opens_on!)}</p>
              <p className="mt-1 text-sm">The form shows here then.</p>
            </Card>
          ) : !open ? (
            <Card>
              <p className="font-medium">{deadline && deadlinePassed(event) ? `Registration closed ${formatDate(deadline)}` : "Registration is closed"}</p>
              <p className="mt-1 text-sm">
                {mine.length > 0 ? "To change your registration, contact the organizer." : "To register a group now, contact the organizer."}
              </p>
              <Link href={`/e/${slug}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline underline-offset-4">
                See the festival page
              </Link>
            </Card>
          ) : full ? (
            <Card>
              <p className="font-medium">This festival is full</p>
              <p className="mt-1 text-sm">Every spot has a group. To ask about a spot, contact the organizer.</p>
            </Card>
          ) : (
            <>
              <h2 className="mb-1 text-2xl font-semibold">{mine.length > 0 ? "Register another group" : "Your group"}</h2>
              <p className="mb-4 text-sm">
                It takes about 2 minutes{deadline ? `, and you can change your answers until registration closes ${formatDate(deadline)}` : ""}.
                {user ? "" : " No account needed: we email you a code to confirm."}
              </p>
              {prefill && <p className="mb-4 text-sm">The organizer filled in {prefill.band_name}&apos;s details. Check each answer before you register.</p>}
              <FestivalForm
                eventId={event.id}
                classifications={event.classifications ?? []}
                askChaperones={event.ask_chaperones}
                askBuses={event.ask_buses}
                askAvailability={event.ask_availability}
                chaperoneLimit={event.chaperone_limit}
                days={eachDate(event.starts_on, event.ends_on).map((d) => ({ value: d, label: weekday(d) }))}
                email={user?.email ?? null}
                initial={
                  prefill
                    ? {
                        band_name: prefill.band_name,
                        school_name: prefill.school_name ?? "",
                        classification: prefill.classification,
                        student_count: prefill.student_count ?? undefined,
                        chaperone_count: prefill.chaperone_count,
                        bus_count: prefill.bus_count ?? 0,
                      }
                    : undefined
                }
              />
              {!user && (
                <p className="mt-4 text-sm">
                  Registered with us before?{" "}
                  <Link href={`/login?next=${encodeURIComponent(`/e/${slug}/register`)}`} className="font-medium text-brand underline underline-offset-4">
                    Sign in first
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
