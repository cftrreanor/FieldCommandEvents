import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { updateBand, updateFestivalGroup, withdrawBand } from "@/app/dashboard/band-actions";
import { FestivalForm } from "@/app/e/[slug]/register/festival-form";
import { weekday } from "@/lib/rooms";
import { eachDate } from "@/lib/time";
import { BandForm } from "@/components/band-form";
import { hasRooms } from "@/lib/event-types";
import { BAND_COLUMNS, registrationIsOpen, type BandRow } from "@/lib/bands";
import { formatPhone } from "@/lib/phone";
import { missing } from "@/lib/schema-check";
import { loadMealOffer, loadMealOrders } from "@/lib/meals";
import { createClient } from "@/lib/supabase/server";
import { WithdrawBandButton } from "../withdraw-band";

export const metadata: Metadata = { title: "Edit registration" };

export default async function EditBandPage({ params }: PageProps<"/dashboard/bands/[bandId]/edit">) {
  const { bandId } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("bands").select(`${BAND_COLUMNS}, available_day, earliest_start, latest_finish`).eq("id", bandId).maybeSingle();
  const band = data as BandRow | null;
  if (!band) missing();
  const { data: event } = await supabase
    .from("events")
    .select(
      "name, status, event_type, timezone, starts_on, ends_on, band_registration_open, band_registration_deadline, band_registration_opens_on, chaperone_limit, classifications, performance_order_published, ask_chaperones, ask_buses, ask_availability",
    )
    .eq("id", band.event_id)
    .single();
  if (!event) missing();
  // Only while registration is open; after that, changes go through the organizer.
  if (!registrationIsOpen(event)) redirect(`/dashboard/bands/${bandId}`);
  const festival = hasRooms(event.event_type);
  const [meals, requests] = await Promise.all([loadMealOffer(supabase, band.event_id), loadMealOrders(supabase, [bandId])]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/dashboard/bands/${bandId}`} className="text-sm text-muted hover:text-foreground">
        ← {festival ? band.band_name : `Back to ${event.name}`}
      </Link>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">{festival ? "Change your registration" : "Edit registration"}</h1>
      <p className="mt-1 text-muted">
        {band.band_name} · {band.school_name}
      </p>
      <div className="mt-6">
        {festival ? (
          <FestivalForm
            eventId={band.event_id}
            classifications={event.classifications ?? []}
            askChaperones={event.ask_chaperones}
            askBuses={event.ask_buses}
            askAvailability={event.ask_availability}
            chaperoneLimit={event.chaperone_limit}
            days={eachDate(event.starts_on, event.ends_on).map((d) => ({ value: d, label: weekday(d) }))}
            email={band.head_director_email}
            initial={band as unknown as Parameters<typeof FestivalForm>[0]["initial"]}
            update={updateFestivalGroup.bind(null, bandId)}
            submitLabel="Save changes"
          />
        ) : (
        <BandForm
          action={updateBand.bind(null, bandId)}
          classifications={event.classifications}
          chaperoneLimit={event.chaperone_limit}
          kind={hasRooms(event.event_type) ? "group" : "band"}
          submitLabel="Save changes"
          initial={{ ...band, head_director_phone: formatPhone(band.head_director_phone), meal_order: requests[bandId] ?? null }}
          meals={meals}
        />
        )}
      </div>
      <div className="mt-8 border-t border-border pt-4 text-sm">
        <WithdrawBandButton
          bandName={band.band_name}
          eventName={event.name}
          removes={!event.performance_order_published}
          one={hasRooms(event.event_type) ? "group" : "band"}
          action={withdrawBand.bind(null, bandId)}
        />
      </div>
    </div>
  );
}
