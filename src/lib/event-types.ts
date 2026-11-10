// What kind of event. Stored as events.event_type. Labels match the website's
// names for each kind (src/lib/audiences.ts), so schools recognize them.

export const EVENT_TYPES = [
  {
    value: "band_contest",
    label: "Band contest",
    icon: "band",
    blurb: "Band registration, the performance schedule, contest-day check-in, and your volunteers, all in one place.",
  },
  {
    value: "group_event",
    label: "Choir, orchestra, or group festival",
    icon: "group",
    blurb: "Choirs, orchestras, theater, speech and debate teams, and other groups register, then move through your rooms on a schedule built for you. Families follow each room live.",
  },
  {
    value: "volunteer",
    label: "Volunteers and sign-ups",
    icon: "volunteer",
    blurb: "Sign-up sheets, volunteer shifts, things to bring like potluck dishes, a check-in desk, and your team. Run everything else your own way.",
  },
  {
    value: "school_visit",
    label: "Family visitor day",
    icon: "school",
    blurb: "Parents register ahead (child, teacher, and grade), are reminded to bring a photo ID, and are checked in at the door. Student details are deleted 30 days after the visit.",
  },
  {
    value: "fair",
    label: "School fair or fundraiser",
    icon: "fair",
    blurb: "Carnivals, fall festivals, and fundraisers: your booths and community partners by zone, a quick partner check-in on the day, volunteer shifts with Coordinators, and a public \u201cWhat's at the event\u201d page.",
  },
  {
    value: "conference",
    label: "Parent-teacher conferences",
    icon: "apple",
    // Each card leads with who it's for, so Meetings and conferences read apart (decisions 2026-11-07).
    blurb: "For teachers: families book a time to talk about their child, on a day you set aside, in person, on video, or by phone. Free for teachers.",
  },
  {
    value: "meeting",
    label: "Meetings",
    icon: "calendar",
    blurb: "For advisers, counselors, coaches, and club officers: your own hours, one day or every week, and anyone with the link books a time, in person, on video, or by phone.",
  },
] as const;
export type EventType = (typeof EVENT_TYPES)[number]["value"];

export const isEventType = (v: unknown): v is EventType => EVENT_TYPES.some((t) => t.value === v);

/** The single performance order, finals and the band check-in path: band contests only. */
export const hasBands = (type: string | null | undefined) => !type || type === "band_contest";

/** Groups that register (the bands table): bands at a band contest, groups at a group event. */
export const hasEnsembles = (type: string | null | undefined) => hasBands(type) || type === "group_event";

/** Rooms, and each group's path through them: group events. */
/** Volunteer events and band contests set up volunteers as jobs (the short job form that saves as you type). */
export const usesJobs = (type: string | null | undefined) => type === "volunteer" || type === "band_contest";

export const hasRooms = (type: string | null | undefined) => type === "group_event";

/** What a registered group is called: "band" or "group". */
export function groupWords(type: string | null | undefined) {
  const one = hasRooms(type) ? "group" : "band";
  const many = `${one}s`;
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  return { one, many, One: cap(one), Many: cap(many) };
}

/** Parent registration and door check-in: school visitor events. */
export const hasParents = (type: string | null | undefined) => type === "school_visit";

/**
 * Meeting times people book: parent-teacher conferences (free; one published at a
 * time per account) and meetings (anyone booking time; no child). Both use the
 * conference setup, booking page, and Meetings list.
 */
export const hasConferences = (type: string | null | undefined) => type === "conference" || type === "meeting";

/** Meetings: booked like conferences, without a child, by anyone. */
export const isMeeting = (type: string | null | undefined) => type === "meeting";

/** The words for who books and what, on conference and meeting pages. */
export function bookingWords(type: string | null | undefined) {
  return isMeeting(type)
    ? {
        child: false,
        // What the event is called in a sentence: "your meetings".
        event: "meetings",
        Event: "Meetings",
        // Who books.
        booker: "person",
        bookers: "people",
        Bookers: "People",
        // The people named on a booking.
        person: "person",
        people: "people",
        // Who they meet.
        host: "you",
      }
    : {
        child: true,
        event: "conferences",
        Event: "Conferences",
        booker: "family",
        bookers: "families",
        Bookers: "Families",
        person: "parent or guardian",
        people: "parents and guardians",
        host: "the teacher",
      };
}

/** Booths, partners and vendors, by zone: school fairs. */
export const hasBooths = (type: string | null | undefined) => type === "fair";

/** What the person who runs one sign-up is called; the same for every event type now. */
export function leadWords(type?: string | null) {
  void type;
  return { one: "Coordinator", many: "Coordinators" };
}

/** Zones a fair's booths and stations usually fall into (any name works). */
export const FAIR_ZONES = ["Game Zone", "Activity Stations", "Marketplace", "Showcase", "Food & Drinks"] as const;

/** "Contest day" for band contests, "Event day" otherwise. */
export const dayLabel = (type: string | null | undefined) => (hasBands(type) ? "Contest day" : "Event day");

export const eventTypeLabel = (type: string | null | undefined) =>
  EVENT_TYPES.find((t) => t.value === type)?.label ?? EVENT_TYPES[0].label;

export const eventTypeIcon = (type: string | null | undefined) =>
  EVENT_TYPES.find((t) => t.value === type)?.icon ?? EVENT_TYPES[0].icon;
