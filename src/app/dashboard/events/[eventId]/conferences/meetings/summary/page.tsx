import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Booking } from "@/lib/conference-bookings";
import { loadConferenceSettings } from "@/lib/conference-settings";
import { getEventAccess } from "@/lib/data";
import { hasConferences, isMeeting } from "@/lib/event-types";
import { RECORDS_NOTE } from "@/lib/records";
import { displayTime, toMinutes, toTime } from "@/lib/schedule";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { conferenceBookedCount, isConferenceTeacher } from "@/lib/conference-access";
import { NotTheTeacher } from "../not-teacher";
import { formatDate, formatDateRange, utcToZonedDate, utcToZonedTime, zoneName } from "@/lib/time";
import { formatPhone } from "@/lib/phone";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Meeting summary" };

const OUTCOME_LABEL = { met: "Met", no_show: "No-show" } as const;

/**
 * One page to print or save as a PDF: each booked meeting's time, student,
 * parents, and whether they met. Only the teacher can open it.
 */
export default async function MeetingSummaryPage({ params }: PageProps<"/dashboard/events/[eventId]/conferences/meetings/summary">) {
  const { eventId } = await params;
  const access = await getEventAccess(eventId);
  if (!access.isHost) redirect(`/dashboard/events/${eventId}`);

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("id, name, event_type, timezone, starts_on, ends_on").eq("id", eventId).maybeSingle();
  if (!event) missing();
  if (!hasConferences(event.event_type)) redirect(`/dashboard/events/${eventId}`);
  if (!(await isConferenceTeacher(supabase, eventId))) return <NotTheTeacher eventId={eventId} booked={await conferenceBookedCount(supabase, eventId)} meeting={isMeeting(event.event_type)} />;

  const columns = "id, starts_at, child_name, parents, meeting_mode, note";
  const load = (extra: string) =>
    supabase
      .from("conference_bookings")
      .select(columns + extra)
      .eq("event_id", eventId)
      .order("starts_at");
  // The number to call for phone calls (before its update, without it).
  const tryCall = await load(", outcome, call_phone");
  const [{ settings }, withOutcomes] = await Promise.all([
    loadConferenceSettings(supabase, eventId),
    isSchemaError(tryCall.error) ? load(", outcome") : Promise.resolve(tryCall),
  ]);
  // Before the conference outcomes update there's no Met / No-show to show.
  const outcomesReady = !isSchemaError(withOutcomes.error);
  const { data, error } = outcomesReady ? withOutcomes : await load("");
  if (error) missing();
  const bookings = (data ?? []) as unknown as (Pick<Booking, "id" | "starts_at" | "child_name" | "parents" | "meeting_mode" | "note"> & {
    call_phone?: string | null;
    outcome?: keyof typeof OUTCOME_LABEL | null;
  })[];

  const tz = event.timezone;
  const weekly = settings.schedule === "weekly";
  const time = (iso: string) => {
    const start = utcToZonedTime(iso, tz);
    const range = `${displayTime(start)} – ${displayTime(toTime(toMinutes(start) + settings.meeting_minutes))}`;
    // Weekly hours run over many days, so each meeting says its day.
    return weekly ? `${formatDate(utcToZonedDate(iso, tz), { year: undefined })} · ${range}` : range;
  };
  // No Student column when the teacher doesn't ask for children's names.
  const students = bookings.some((b) => b.child_name);
  const met = bookings.filter((b) => b.outcome === "met").length;
  const noShows = bookings.filter((b) => b.outcome === "no_show").length;
  const unmarked = bookings.length - met - noShows;
  // Printed before the day (no meeting has started): a sheet to work from, with how they're meeting, a
  // number, their note, and a blank box to tick, instead of "Not marked" on every row (decisions 2026-11-07).
  // A sheet to work from while any meeting is still to come (the day itself included): how, a number,
  // and the note. Each row then shows a box to tick if it's still to come, or how it went.
  const nowIso = new Date().toISOString();
  const beforeDay = bookings.some((b) => b.starts_at > nowIso);
  const upcoming = (b: { starts_at: string }) => b.starts_at > nowIso;
  const HOW = { in_person: "In person", video: "Video", phone: "Phone call" } as const;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/dashboard/events/${eventId}/conferences/meetings`} className="text-sm text-muted hover:text-foreground">
          ← Back to Your meetings
        </Link>
        <PrintButton />
      </div>
      <p className="mt-2 text-xs text-muted print:hidden">{RECORDS_NOTE}</p>

      <h1 className="mt-6 text-2xl font-semibold print:mt-0">Meeting summary</h1>
      <p className="mt-1 text-sm text-muted">
        {event.name} · {weekly ? `Every week · ${formatDateRange(event.starts_on, event.ends_on)}` : formatDate(event.starts_on)} · All times are{" "}
        {zoneName(tz)}
      </p>
      <p className="mt-2 text-sm">
        <span className="font-semibold">{bookings.length}</span> {bookings.length === 1 ? "meeting" : "meetings"}
        {outcomesReady && bookings.some((b) => !upcoming(b)) && (
          <>
            {" "}
            · <span className="font-semibold">{met}</span> met · <span className="font-semibold">{noShows}</span>{" "}
            {noShows === 1 ? "no-show" : "no-shows"}
            {unmarked > 0 && (
              <>
                {" "}
                · <span className="font-semibold">{unmarked}</span> not marked
              </>
            )}
          </>
        )}
      </p>

      {bookings.length === 0 ? (
        <p className="mt-6 text-muted">No meetings booked.</p>
      ) : (
        // On phones each meeting stacks, with its labels; the table is for wider screens and print (WCAG 1.4.10).
        <table className="mt-5 w-full border-collapse text-left text-sm max-sm:block print:table">
          <thead className="max-sm:hidden print:table-header-group">
            <tr className="border-b-2 border-foreground">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Time
              </th>
              {students && (
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Student
                </th>
              )}
              <th scope="col" className="py-2 pr-3 font-semibold">
                {students ? "Parents" : "Who"}
              </th>
              {beforeDay && (
                <>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    How
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Phone
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Note
                  </th>
                </>
              )}
              {outcomesReady && (
                <th scope="col" className="py-2 font-semibold">
                  Met
                </th>
              )}
            </tr>
          </thead>
          <tbody className="max-sm:block print:table-row-group">
            {bookings.map((b) => (
              <tr key={b.id} className="break-inside-avoid border-b border-border align-top max-sm:block max-sm:py-2 print:table-row">
                <td data-label="Time" className="whitespace-nowrap py-2 pr-3 tabular-nums max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">{time(b.starts_at)}</td>
                {students && <td data-label="Student" className="py-2 pr-3 font-medium max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">{b.child_name}</td>}
                <td data-label="Who" className="py-2 pr-3 max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">{b.parents.map((p) => p.name).join(", ")}</td>
                {beforeDay && (
                  <>
                    <td data-label="How" className="whitespace-nowrap py-2 pr-3 max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">{HOW[b.meeting_mode] ?? ""}</td>
                    <td data-label="Phone" className="whitespace-nowrap py-2 pr-3 tabular-nums max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">
                      {/* A phone call: the number they gave to be called on. */}
                      {formatPhone((b.meeting_mode === "phone" ? b.call_phone : null) ?? b.parents.find((p) => p.phone)?.phone ?? null)}
                    </td>
                    <td data-label="Note" className="py-2 pr-3 max-sm:block max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell">{b.note}</td>
                  </>
                )}
                {outcomesReady && (
                  <td data-label="Met" className={`${upcoming(b) ? "max-sm:hidden" : "max-sm:block"} whitespace-nowrap py-2 max-sm:py-0.5 max-sm:whitespace-normal max-sm:before:mr-1 max-sm:before:font-semibold max-sm:before:content-[attr(data-label)] max-sm:empty:hidden print:table-cell`}>
                    {upcoming(b) ? (
                      // A box to tick on paper; on screen it would look like a button.
                      <span aria-label="Not yet" className="hidden size-5 rounded-sm border-2 border-foreground align-middle print:inline-block" />
                    ) : b.outcome ? (
                      OUTCOME_LABEL[b.outcome]
                    ) : (
                      "Not marked"
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
