import { DayBar } from "@/components/event-day-nav";
import { SetupStrip } from "@/components/setup-guide";
import { loadDayActions } from "@/lib/event-day-actions";
import { loadSetupFacts } from "@/lib/setup-facts";
import { bandRegistrationMissing, emptyJobsNote, festivalRegistrationMissing, festivalRoomsMissing, setupChecklist, type SetupFacts } from "@/lib/setup-checklist";
import { SetupSteps } from "@/components/volunteer-steps";
import { STEP_PATHS, type SetupStepFacts, type StepsKind } from "@/lib/setup-steps";
import { hasConferences, hasRooms } from "@/lib/event-types";

/**
 * Every page of an event. On the day itself, the team's jobs of the day are a
 * tap away on every page; other days, hosts see where setup stands and the
 * next step (the strip hides itself where it isn't wanted).
 */
export default async function EventLayout({ children, params }: LayoutProps<"/dashboard/events/[eventId]">) {
  const { eventId } = await params;
  const day = await loadDayActions(eventId);
  const facts = day ? null : await loadSetupFacts(eventId);
  // A volunteer event or band contest being set up: Details, its middle step (Jobs and shifts, or
  // Registration), and Publish as three steps along the top of those pages.
  const kind: StepsKind | null =
    facts && !facts.published
      ? facts.eventType === "volunteer"
        ? "volunteer"
        : facts.eventType === "band_contest"
          ? "band"
          : hasRooms(facts.eventType)
            ? "festival"
            : hasConferences(facts.eventType)
            ? "meeting"
            : null
      : null;
  const steps =
    facts && kind
      ? kind === "volunteer"
        ? volunteerSteps(facts)
        : kind === "band"
          ? bandSteps(facts)
          : kind === "festival"
            ? festivalSteps(facts)
            : meetingSteps(facts)
      : null;
  return (
    <>
      {day && <DayBar day={day} />}
      {steps && kind && <SetupSteps eventId={eventId} kind={kind} facts={steps} />}
      {/* A meetings draft's Meeting setup page only redirects to a step: no setup bar there either, or it flashes on the way. */}
      {/* Festivals: the step bar while setting up, the event page's next step once live; no setup strip (owner, 2026-11-11). */}
      {facts && facts.eventType !== "group_event" && <SetupStrip eventId={eventId} initial={setupChecklist(facts)} skip={kind ? (kind === "meeting" ? [...STEP_PATHS.meeting, "/conferences"] : STEP_PATHS[kind]) : undefined} />}
      {children}
      {/* Room for the tab bar along the bottom of a phone. */}
      {day && <div aria-hidden className="h-16 lg:hidden print:hidden" />}
    </>
  );
}

function volunteerSteps(f: SetupFacts): SetupStepFacts {
  const empty = f.emptyJobs ?? [];
  const middleDone = (f.readyJobs ?? 0) > 0 && empty.length === 0;
  return {
    middleDone,
    middleNote: middleDone ? null : f.stations === 0 ? "Add a job" : emptyJobsNote(empty),
    count: f.stations ? `${f.stations} ${f.stations === 1 ? "job" : "jobs"}` : null,
  };
}

function bandSteps(f: SetupFacts): SetupStepFacts {
  const missing = bandRegistrationMissing(f);
  const empty = f.emptyJobs ?? [];
  return {
    middleDone: missing === null,
    middleNote: missing,
    count: null,
    // Optional: done once there's a job volunteers can see, and every job has something to sign up for.
    volunteersDone: (f.readyJobs ?? 0) > 0 && empty.length === 0,
    volunteersNote: empty.length ? `Optional · ${emptyJobsNote(empty)}` : "Optional",
  };
}

/**
 * A festival: Rooms and schedule needs a room in the rotation, Registration needs a deadline (the database checks
 * both before publishing); Volunteers never blocks.
 */
function festivalSteps(f: SetupFacts): SetupStepFacts {
  const rooms = festivalRoomsMissing(f);
  const registration = festivalRegistrationMissing(f);
  const empty = f.emptyJobs ?? [];
  return {
    middleDone: !rooms,
    middleNote: rooms,
    count: f.rooms ? `${f.rooms} ${f.rooms === 1 ? "room" : "rooms"}` : null,
    done: { rooms: !rooms, registration: !registration },
    notes: { rooms, registration },
    volunteersDone: (f.readyJobs ?? 0) > 0 && empty.length === 0,
    volunteersNote: empty.length ? `Optional · ${emptyJobsNote(empty)}` : "Optional",
  };
}

/** Meetings and conferences: Meeting times and Where you'll meet each say what they still need; More options never blocks. */
function meetingSteps(f: SetupFacts): SetupStepFacts {
  const times = f.conferenceTimesMissing ?? null;
  const place = f.conferencePlaceMissing ?? null;
  return {
    middleDone: !times,
    middleNote: times,
    count: null,
    done: { times: !times, place: !place, options: false },
    notes: { times, place: place?.replace(/\.$/, "") ?? null, options: "Optional" },
    // One day: no More options step; its one setting (the contact email) is on Publish (owner, 2026-11-09).
    skip: f.conferenceWeekly ? undefined : ["options"],
  };
}
