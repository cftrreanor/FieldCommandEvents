// Parent-teacher conferences: one day's block cut into meetings, or the same
// hours every week (in Schedule Command and up). Times are "HH:MM" in the event's time
// zone (see lib/schedule).
import { displayTime, toMinutes, toTime } from "@/lib/schedule";

export const MEETING_LENGTHS = [10, 15, 20, 25, 30, 45, 60] as const;
export const GAP_LENGTHS = [0, 5, 10, 15] as const;

/** One way to meet. A teacher offers one or more; each booking has one. */
export type Mode = "in_person" | "video" | "phone";
export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "in_person", label: "In person", hint: "Families come to your room." },
  { value: "video", label: "Video", hint: "Families join your Zoom or Google Meet." },
  { value: "phone", label: "Phone call", hint: "You call each family at the number they give. We never show your number." },
];
export const isMode = (m: unknown): m is Mode => MODES.some((x) => x.value === m);

/** The old single setting, before several ways to meet (20261213000000): "either" was in person or video. */
export type MeetingMode = Mode | "either";

/** A conference day, or the same hours every week (Schedule Command and up). */
export type Schedule = "one_day" | "weekly";

/** One block of weekly hours: day 0 is Sunday, as JavaScript's getDay() and Postgres's dow count them. */
export type WeeklyRange = { day: number; start: string; end: string };

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** How much notice families give before a weekly meeting, in hours. */
export const NOTICE_HOURS = [0, 2, 12, 24, 48, 72, 168] as const;
/** How far ahead families can book weekly meetings, in days. */
export const AHEAD_DAYS = [7, 14, 21, 28, 60, 90] as const;

export function noticeLabel(h: number) {
  if (h === 0) return "No notice needed";
  if (h === 168) return "1 week";
  if (h % 24 === 0) return `${h / 24} ${h === 24 ? "day" : "days"}`;
  return `${h} hours`;
}

export function aheadLabel(d: number) {
  return d % 7 === 0 && d <= 28 ? `${d / 7} ${d === 7 ? "week" : "weeks"}` : `${d} days`;
}

export type ConferenceBreak = { start: string; minutes: number; label: string };

export type ConferenceSettings = {
  meeting_minutes: number;
  gap_minutes: number;
  breaks: ConferenceBreak[];
  times_saved_at: string | null;
  meeting_mode: MeetingMode | null;
  /** Every way the teacher offers (missing before the 20261213000000 update; read it with modesOf). */
  meeting_modes?: Mode[] | null;
  room: string | null;
  video_link: string | null;
  /** The meeting's passcode, when the link doesn't carry it (missing before the 20261229000000 update). */
  video_passcode?: string | null;
  waiting_room_confirmed: boolean;
  /** The teacher sends families the video link themselves (in their own calendar invite). */
  own_link: boolean;
  schedule: Schedule;
  weekly_hours: WeeklyRange[];
  /** Days off from weekly hours, "YYYY-MM-DD". */
  closed_dates: string[];
  min_notice_hours: number;
  max_days_ahead: number;
  /** Shown on the booking page when every time is booked, if the organizer adds one (20270124000000). */
  contact_email?: string | null;
};

export const DEFAULT_SETTINGS: ConferenceSettings = {
  meeting_minutes: 15,
  gap_minutes: 0,
  breaks: [],
  times_saved_at: null,
  meeting_mode: null,
  room: null,
  video_link: null,
  waiting_room_confirmed: false,
  own_link: false,
  schedule: "one_day",
  weekly_hours: [],
  closed_dates: [],
  min_notice_hours: 24,
  max_days_ahead: 14,
};

/** Before the weekly hours update (20261211000000) has been run. */
export const LEGACY_SETTINGS_COLUMNS =
  "meeting_minutes, gap_minutes, breaks, times_saved_at, meeting_mode, room, video_link, waiting_room_confirmed, own_link";
/** Before the several-ways-to-meet update (20261213000000) has been run. */
export const WEEKLY_SETTINGS_COLUMNS = `${LEGACY_SETTINGS_COLUMNS}, schedule, weekly_hours, closed_dates, min_notice_hours, max_days_ahead`;
/** Before the passcode update (20261229000000) has been run. */
export const MODES_SETTINGS_COLUMNS = `${WEEKLY_SETTINGS_COLUMNS}, meeting_modes`;
/** Before the contact email update (20270124000000) has been run. */
export const PASSCODE_SETTINGS_COLUMNS = `${MODES_SETTINGS_COLUMNS}, video_passcode`;
export const SETTINGS_COLUMNS = `${PASSCODE_SETTINGS_COLUMNS}, contact_email`;

/** The ways a conference offers, in a fixed order (from the old single setting before the update). */
export function modesOf(s: Pick<ConferenceSettings, "meeting_mode" | "meeting_modes"> | null): Mode[] {
  const list = s?.meeting_modes?.length ? s.meeting_modes : s?.meeting_mode === "either" ? (["in_person", "video"] as Mode[]) : s?.meeting_mode ? [s.meeting_mode] : [];
  return MODES.map((m) => m.value).filter((m) => list.includes(m));
}

/** "In person", "In person or phone call", "In person, video, or phone call". */
export function modesLabel(modes: Mode[]): string | null {
  const words = modes.map((m, i) => {
    const label = MODES.find((x) => x.value === m)!.label;
    return i === 0 ? label : label.toLowerCase();
  });
  if (!words.length) return null;
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} or ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, or ${words.at(-1)}`;
}

/**
 * Each meeting's start between `start` and `end`: back to back (plus the
 * gap), skipping any that would run into a break.
 */
export function meetingStarts(
  start: string,
  end: string,
  s: Pick<ConferenceSettings, "meeting_minutes" | "gap_minutes" | "breaks">,
): string[] {
  const len = s.meeting_minutes;
  const finish = toMinutes(end);
  const breaks = s.breaks
    .filter((b) => b.start && b.minutes > 0)
    .map((b) => ({ start: toMinutes(b.start), end: toMinutes(b.start) + b.minutes }))
    .sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let t = toMinutes(start);
  while (t + len <= finish && out.length < 200) {
    const clash = breaks.find((b) => t < b.end && t + len > b.start);
    if (clash) {
      t = clash.end;
      continue;
    }
    out.push(toTime(t));
    t += len + s.gap_minutes;
  }
  return out;
}

/** Weekly hours shared by several days, as set up: "Tue and Thu, 3:30 – 4:30 PM". */
export type HoursGroup = { days: number[]; start: string; end: string };

/** Weekly hours gathered into groups of days that share the same times. */
export function groupWeekly(hours: WeeklyRange[]): HoursGroup[] {
  const groups: HoursGroup[] = [];
  for (const h of sortWeekly(hours)) {
    const g = groups.find((x) => x.start === h.start && x.end === h.end);
    if (g) g.days.push(h.day);
    else groups.push({ days: [h.day], start: h.start, end: h.end });
  }
  return groups;
}

/** Each day in a range of dates, "YYYY-MM-DD", inclusive (up to a year). */
export function datesBetween(from: string, to: string): string[] {
  if (!from) return [];
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const last = to && to >= from ? to : from;
  while (out.length < 366) {
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= last) break;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Days off gathered into runs of back-to-back dates, like a week of winter break. */
export function dateRuns(dates: string[]): { from: string; to: string }[] {
  const runs: { from: string; to: string }[] = [];
  for (const d of [...new Set(dates)].sort()) {
    const last = runs.at(-1);
    if (last && datesBetween(last.to, d).length === 2) last.to = d;
    else runs.push({ from: d, to: d });
  }
  return runs;
}

/** Weekly hours sorted by day, then time. */
export const sortWeekly = (hours: WeeklyRange[]) => [...hours].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

/** Meetings in each week's hours. */
export function weeklyMeetingCount(hours: WeeklyRange[], s: Pick<ConferenceSettings, "meeting_minutes" | "gap_minutes" | "breaks">) {
  return hours.reduce((n, h) => n + meetingStarts(h.start, h.end, s).length, 0);
}

/** "Tuesdays 3:30 – 4:30 PM · Thursdays 3:30 – 4:30 PM" */
export function weeklySummary(hours: WeeklyRange[]) {
  if (!hours.length) return "No weekly hours yet";
  return sortWeekly(hours)
    .map((h) => `${WEEKDAYS[h.day]}s ${displayTime(h.start)} – ${displayTime(h.end)}`)
    .join(" · ");
}

/** "18 times · 3:00 PM – 7:15 PM": the openings people can book ("meetings" are what's booked). */
export function meetingSummary(starts: string[], meetingMinutes: number) {
  if (!starts.length) return "No times fit in your hours yet";
  const last = toTime(toMinutes(starts[starts.length - 1]) + meetingMinutes);
  return `${starts.length} ${starts.length === 1 ? "time" : "times"} · ${displayTime(starts[0])} – ${displayTime(last)}`;
}

/**
 * What the Where you'll meet tab still needs (null when done). In person
 * needs the school's address (kept on the event) and a room; video needs a
 * link pasted here with the waiting room ticked, unless the teacher sends
 * their own.
 */
export function placeMissing(s: ConferenceSettings | null, venueAddress: string | null, eventType?: string | null): string | null {
  const modes = modesOf(s);
  if (!s || !modes.length) return "Choose where you'll meet.";
  if (modes.includes("in_person") && !venueAddress?.trim()) return eventType === "meeting" ? "Add the address." : "Add your school's address.";
  if (modes.includes("in_person") && !s.room?.trim()) return "Add your room and directions.";
  if (modes.includes("video") && !s.video_link) return "Add your meeting link.";
  if (modes.includes("video") && !s.waiting_room_confirmed)
    return "Tick that your meeting has a waiting room and runs the whole time.";
  return null;
}

/** What's still needed before publishing, matching the database's check (null when ready). */
export function notReady(s: ConferenceSettings | null, venueAddress: string | null, eventType?: string | null): string | null {
  if (!s?.times_saved_at) return "Save your meeting times.";
  if (s.schedule === "weekly" && !s.weekly_hours.length) return "Add your weekly hours.";
  return placeMissing(s, venueAddress, eventType);
}


/** A booked meeting, in the event's time zone: who, the day ("2026-11-14"), and the start ("09:15"). */
export type BookedTime = { who: string; date: string; time: string };

/**
 * The booked meetings that no longer fit new times: on another day, outside the hours, in a break,
 * or no longer on a meeting start (a new length or gap). They stay booked; the organizer is told
 * who, before saving (decisions 2026-11-07, finding 2).
 */
export function bookingsOutside(
  booked: BookedTime[],
  t: {
    schedule: Schedule;
    day: string;
    from: string;
    to: string;
    weekly: WeeklyRange[];
    firstDay: string;
    lastDay: string;
    /** Days off (weekly hours): a meeting on one doesn't fit. */
    closed?: string[];
    lengths: Pick<ConferenceSettings, "meeting_minutes" | "gap_minutes" | "breaks">;
    /** One day, moving to another day: booked meetings move with it, so only their time has to fit. */
    movesWithDay?: boolean;
  },
): BookedTime[] {
  return booked.filter((b) => {
    if (t.schedule === "one_day") return (!t.movesWithDay && b.date !== t.day) || !meetingStarts(t.from, t.to, t.lengths).includes(b.time);
    if (b.date < t.firstDay || (t.lastDay && b.date > t.lastDay) || t.closed?.includes(b.date)) return true;
    const weekday = new Date(`${b.date}T12:00:00Z`).getUTCDay();
    return !t.weekly.some((h) => h.day === weekday && meetingStarts(h.start, h.end, t.lengths).includes(b.time));
  });
}
