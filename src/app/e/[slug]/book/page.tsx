import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { EventHeaderBar } from "@/components/event-brand";
import { Card } from "@/components/ui";
import { formatDuration } from "@/lib/schedule";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { modesLabel, modesOf, weeklySummary } from "@/lib/conferences";
import { formatDate, formatTime, formatTimeRange, utcToZonedDate, zoneName } from "@/lib/time";
import { bookingWords } from "@/lib/event-types";
import { bookConference } from "./actions";
import { BookingForm } from "./booking-form";
import { loadConference } from "./data";
import { PrivacyNote } from "./privacy-note";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const conf = await loadConference({ slug: (await params).slug });
  return { title: conf ? `Book a time: ${conf.event.name}` : "Book a time" };
}

/** Families book a parent-teacher conference, or anyone books a meeting: only open times are shown. */
export default async function BookConferencePage({ params, searchParams }: Params) {
  const { slug } = await params;
  const { canceled } = await searchParams;
  const conf = await loadConference({ slug });
  if (!conf) {
    const supabase = await createClient();
    const { data } = await supabase.from("events").select("id").eq("slug", slug).maybeSingle();
    if (data) redirect(`/e/${slug}`);
    missing();
  }
  const { event, settings, teacher, askChild } = conf;
  const published = event.status === "published";
  const words = bookingWords(event.event_type);
  const supabase = await createClient();
  // A draft is only previewed by the teacher (who can read it), like any event page.
  if (!published && !(await supabase.from("events").select("id").eq("id", event.id).maybeSingle()).data) missing();
  const { data: open } = published ? await supabase.rpc("conference_open_times", { p_slug: slug }) : { data: [] };
  const times = ((open ?? []) as { starts_at: string }[]).map((t) => {
    const day = utcToZonedDate(t.starts_at, event.timezone);
    return { value: t.starts_at, label: formatTime(t.starts_at, event.timezone), day, dayLabel: formatDate(day, { year: undefined }) };
  });
  const weekly = settings.schedule === "weekly";
  const school = [event.venue_name, event.venue_address].filter(Boolean).join(", ");
  // Where to meet: with one way, its details; with more, the family picks below.
  const place = [settings.room, school].filter(Boolean).join(", ");
  const modes = modesOf(settings);
  const only: Record<string, string> = {
    in_person: place ? `In person: ${place}` : "In person",
    video: "Video. You'll get the details when you book.",
    phone: `Phone call. ${teacher.name} calls you at the number you give.`,
  };
  const ways = modes.length > 1 ? `${modesLabel(modes)}. You choose below.` : (only[modes[0]] ?? "");
  const summary: [string, ReactNode][] = [
    [
      "When",
      weekly ? (
        <>
          Every week: {weeklySummary(settings.weekly_hours)}
          <span className="block text-muted">Through {formatDate(event.ends_on, { year: undefined })}</span>
        </>
      ) : (
        `${formatDate(event.starts_on)} · ${formatTimeRange(event.window_start, event.window_end, event.timezone)}`
      ),
    ],
    ["Meetings", `${formatDuration(settings.meeting_minutes)} each`],
    ["How you'll meet", ways],
  ];

  return (
    <>
      <EventHeaderBar slug={slug} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
        <header>
          <p className="text-sm font-medium text-muted">{words.child ? "Parent-teacher conference" : "Book a meeting"}</p>
          <h1 className="mt-1 text-4xl font-medium tracking-tight sm:text-5xl">{event.name}</h1>
          <p className="mt-2 text-xl font-medium">with {teacher.name}</p>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border pt-4">
            {summary.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-sm font-semibold text-muted sm:text-base">{term}</dt>
                <dd className="text-sm sm:text-base">{value}</dd>
              </div>
            ))}
          </dl>
          {event.public_notes && <p className="mt-4 leading-7">{event.public_notes}</p>}
        </header>

        {canceled === "1" && (
          <Card className="mt-6 bg-brand-soft" role="status">
            <p className="font-medium">Your {words.child ? "conference" : "meeting"} was canceled. You can book another time below.</p>
          </Card>
        )}

        <div className="mt-8">
          {published ? (
            <>
              <BookingForm
                action={bookConference.bind(null, event.id)}
                times={times}
                modes={modes}
                teacher={teacher.name}
                shared={teacher.shared}
                place={place}
                zone={zoneName(event.timezone)}
                askChild={askChild}
                calendar={weekly}
                meeting={!words.child}
                contact={times.length ? null : teacher.email}
              />
              <div className="mt-6">
                <PrivacyNote teacher={teacher.name} weekly={weekly || !words.child} askChild={askChild} shared={teacher.shared} />
              </div>
            </>
          ) : (
            <Card>
              <p className="font-medium">Preview: booking opens when {teacher.name} publishes these {words.event}.</p>
            </Card>
          )}
        </div>
      </main>
    </>
  );
}
