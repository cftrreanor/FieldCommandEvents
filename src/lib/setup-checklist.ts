import { groupWords, hasBooths, hasConferences, hasEnsembles, hasParents, hasRooms, isMeeting } from "@/lib/event-types";
import { formatDate } from "@/lib/time";

/**
 * The host's setup checklist for one event: what to do before publishing,
 * the publish step itself, and what to open once it's live. Each step is
 * ticked from the event's real data, so it can't drift from what's set up.
 */
export type SetupStep = {
  id: string;
  label: string;
  /** One line on why, or what "done" means. */
  hint: string;
  href: string;
  done: boolean;
  /** Recommended before publishing (otherwise optional). */
  required: boolean;
  /** Started but not finished (something's saved): how far along, and what's there so far. */
  partial?: { fraction: number; note: string };
  /** Has a due date: shown as its tag ("Due Sep 25") instead of "Optional". */
  due?: string;
};

export type SetupFacts = {
  eventId: string;
  eventType: string;
  published: boolean;
  stations: number;
  shifts: number;
  /** Volunteer jobs with a shift or a thing to bring (what publishing a volunteer event needs). */
  readyJobs?: number;
  /** Volunteer jobs with neither yet: volunteers won't see them on the sign-up page. */
  emptyJobs?: { id: string; name: string; items: boolean }[];
  /** Stations marked as check-in stops (band contests). */
  checkInStops: number;
  /** Band invitations sent (or waiting for registration's opening day). */
  directorInvites?: number;
  /** People who've joined the event's team (co-hosts and leads). */
  team: number;
  /** Team invitations sent but not accepted yet. */
  invitesPending: number;
  files: number;
  volunteerSignupOpen: boolean;
  bandRegistrationOpen: boolean;
  scheduleShared: boolean;
  /** Band contests: finals times exist, are published, and finalist names are revealed. */
  finalsSlots: number;
  finalsPublished: boolean;
  finalistsRevealed: boolean;
  directorInfo: boolean;
  /** Band contests: a registration deadline is set, and how many classifications there are. */
  registrationDeadline?: boolean;
  /** A draft band contest's deadline has already passed: it needs a new one before publishing. */
  registrationDeadlinePast?: boolean;
  /** The day band registration opens (null: when the event is published). */
  registrationOpensOn?: string | null;
  /** The event's first day (YYYY-MM-DD). */
  startsOn?: string;
  classifications?: number;
  pathRooms: number;
  /** Group events: every room, on the path or not. */
  rooms: number;
  /** Performance (or room) times built, published or not. */
  scheduleSlots: number;
  /** Conferences: meeting times saved (the place may still be missing). */
  conferenceTimesSaved?: boolean;
  booths: number;
  parentRegistrationOpen: boolean;
  parentClosesAt: boolean;
  /** Conferences: what's still needed before publishing (null when ready). */
  conferenceMissing?: string | null;
  conferenceTimesMissing?: string | null;
  conferencePlaceMissing?: string | null;
  /**
   * Why the account's plan won't let it publish (20261223000000_packages.sql), and for
   * "one at a time", the event already published. Null when the plan allows it.
   */
  planBlock?: { reason: string; other: { id: string; name: string } | null } | null;
};

export type SetupChecklist = {
  eventId: string;
  before: SetupStep[];
  publish: SetupStep;
  after: SetupStep[];
  /** Recommended steps still to do before publishing. */
  remaining: SetupStep[];
  doneCount: number;
  total: number;
  /** The one step to do next (none when everything's done). */
  next: SetupStep | null;
  /** A step that's started but not finished: where to pick up after stepping away. */
  inProgress: SetupStep | null;
  /** One segment per counted step, for the progress line. */
  segments: { id: string; state: "done" | "partial" | "todo"; fraction: number }[];
  /**
   * What the progress line counts: before publishing, only what's needed to
   * publish; once live, the steps that come after. Optional steps never count.
   */
  progress: { label: string; done: number; of: number };
  /** Live, and every after-publish step done: the checklist can step aside. */
  complete: boolean;
};

// Same order as the sections on the event page: what people sign up for, the schedule, volunteers, the day, team, maps.
const BEFORE_ORDER = ["details", "registration", "director-info", "booths", "conference-times", "conference-place", "parents-close", "rooms", "shifts", "team", "files"];

/**
 * A volunteer event's jobs: done once a job has a shift or a thing to bring
 * (the database won't publish without one).
 */
function jobsStep(f: SetupFacts, base: string): SetupStep {
  const ready = f.readyJobs ?? (f.stations > 0 && f.shifts > 0 ? 1 : 0);
  const empty = f.emptyJobs ?? [];
  // Done only when every job has something to sign up for: an empty one never reaches the sign-up page.
  return {
    id: "shifts",
    label: "Add volunteer jobs and shifts",
    hint: "What volunteers sign up for.",
    href: `${base}/volunteering${empty.length ? `?station=${empty[0].id}` : ""}`,
    done: ready > 0 && empty.length === 0,
    required: true,
    partial: f.stations > 0 && (ready === 0 || empty.length > 0) ? { fraction: 0.5, note: emptyJobsNote(empty) } : undefined,
  };
}

/** "Litter pickup needs a shift" / "2 jobs need a shift or a thing to bring". */
/** What a band contest still needs before directors can register ("Add a deadline"), or null. */
export function bandRegistrationMissing(f: Pick<SetupFacts, "registrationDeadline" | "classifications" | "registrationDeadlinePast" | "published">) {
  const cls = (f.classifications ?? 0) > 0;
  if (f.registrationDeadlinePast && !f.published) return cls ? "Pick a new deadline: it has passed" : "Pick a new deadline and add a classification";
  if (!f.registrationDeadline && !cls) return "Add a deadline and a classification";
  if (!f.registrationDeadline) return "Add a deadline";
  if (!cls) return "Add a classification";
  return null;
}

export function emptyJobsNote(empty: { name: string; items: boolean }[]) {
  if (empty.length === 1) return `${empty[0].name} needs ${empty[0].items ? "a thing to bring" : "a shift"}`;
  return `${empty.length} jobs need a shift or a thing to bring`;
}

export function setupChecklist(f: SetupFacts): SetupChecklist {
  const base = `/dashboard/events/${f.eventId}`;
  const groups = hasEnsembles(f.eventType);
  const words = groupWords(f.eventType);
  const volunteerEvent = f.eventType === "volunteer";
  const hasShifts = f.stations > 0 && f.shifts > 0;

  const before: SetupStep[] = [
    {
      id: "details",
      label: "Add the date, time, and place",
      hint: "Shown on your public page. You can change them later.",
      href: `${base}/edit`,
      done: true,
      required: true,
    },
  ];
  if (hasRooms(f.eventType)) {
    before.push({
      id: "rooms",
      label: "Add rooms and the path groups follow",
      hint: "The schedule is built from your rooms.",
      href: `${base}/rooms#rooms-heading`,
      done: f.pathRooms > 0,
      required: true,
      partial: f.rooms > 0 ? { fraction: 0.5, note: `${f.rooms} room${f.rooms === 1 ? "" : "s"}, path not set yet` } : undefined,
    });
  }
  if (f.eventType === "band_contest") {
    const missing = bandRegistrationMissing(f);
    before.push(
      {
        id: "registration",
        label: "Set up band registration",
        hint: "Classifications and a deadline: what directors need to register.",
        href: `${base}/bands`,
        done: missing === null,
        required: true,
        partial: missing && (f.registrationDeadline || (f.classifications ?? 0) > 0) ? { fraction: 0.5, note: missing } : undefined,
      },
    );
  }
  if (hasBooths(f.eventType)) {
    before.push({
      id: "booths",
      label: "Add booths and partners",
      hint: "Booths you list publicly appear on your event page.",
      href: `${base}/booths`,
      done: f.booths > 0,
      required: true,
    });
  }
  if (hasConferences(f.eventType)) {
    // The same two required steps as the step bar along the top (Meeting times, Where you'll meet), so every
    // page counts what's left the same way (light check, 2026-11-08).
    before.push(
      {
        id: "conference-times",
        label: "Set your meeting times",
        hint: f.conferenceTimesMissing ?? "The day or weekly hours, and how long each meeting is.",
        href: `${base}/conferences/times`,
        done: !f.conferenceTimesMissing,
        required: true,
      },
      {
        id: "conference-place",
        label: "Choose where you'll meet",
        hint: f.conferencePlaceMissing ?? "In person, video, or phone calls.",
        href: `${base}/conferences/place`,
        done: !f.conferencePlaceMissing,
        required: true,
      },
    );
  }
  if (hasParents(f.eventType)) {
    before.push({
      id: "parents-close",
      label: "Choose when parent registration closes",
      hint: "Or close it by hand when you're ready.",
      href: `${base}/parents?tab=settings`,
      done: f.parentClosesAt,
      required: false,
    });
  }
  // A teacher's conference (or someone's meetings) is just them: no volunteers, team or documents.
  if (!hasConferences(f.eventType)) {
    before.push(
      volunteerEvent
        ? jobsStep(f, base)
        : f.eventType === "band_contest"
          ? // A band contest's jobs work the same way, but publishing doesn't need them. (Once live, unfinished jobs move after publishing.)
            { ...jobsStep(f, base), hint: "Only if you need volunteers.", required: false }
          : {
        id: "shifts",
        label: "Add volunteer sign-ups and shifts",
        hint: "Only if you need volunteers.",
        href: `${base}/volunteering`,
        done: hasShifts,
        required: false,
        partial: f.stations > 0 ? { fraction: 0.5, note: `${f.stations} sign-up${f.stations === 1 ? "" : "s"}, no shifts yet` } : undefined,
      },
      {
        id: "team",
        label: "Invite your team",
        hint: "Co-hosts and leads who help you run the day.",
        href: `${base}/edit?section=team`,
        done: f.team > 0,
        required: false,
        partial:
          f.invitesPending > 0
            ? { fraction: 0.5, note: `${f.invitesPending} invitation${f.invitesPending === 1 ? "" : "s"} waiting to be accepted` }
            : undefined,
      },
      {
        id: "files",
        label: "Add maps or documents",
        hint: "Parking maps, packets, schedules.",
        href: `${base}/edit?section=files`,
        done: f.files > 0,
        required: false,
      },
    );
  }

  const bandContest = f.eventType === "band_contest";
  const publish: SetupStep = {
    id: "publish",
    // A band contest's publishing is what opens registration.
    label: bandContest ? "Publish registration" : "Publish your event",
    hint: bandContest
      ? f.registrationOpensOn
        ? `Puts your contest page online. Directors can register from ${formatDate(f.registrationOpensOn, { year: undefined })}.`
        : "Puts your contest page online, and directors can register."
      : "Puts your public page online. You can unpublish at any time.",
    href: `${base}#publish`,
    done: f.published,
    required: true,
  };

  const after: SetupStep[] = [];
  if ((hasShifts || volunteerEvent) && !hasConferences(f.eventType)) {
    after.push({
      id: "signup",
      label: "Open volunteer sign-up",
      hint: "Then share the sign-up link or QR code.",
      href: `${base}/volunteering`,
      done: f.published && f.volunteerSignupOpen,
      required: false,
    });
  }
  if (f.eventType === "band_contest") {
    // Right after publishing, the next job is telling directors. Before contest day: where bands check in.
    after.unshift({
      id: "invite",
      label: "Invite band directors",
      hint: "From your earlier contests or your own list.",
      href: `${base}/bands?tab=invite`,
      done: f.published && (f.directorInvites ?? 0) > 0,
      required: false,
    });
    after.push({
      id: "check-in",
      label: "Set your band check-in order",
      hint: "The stops bands go through, like parking, check-in, and the gate, so volunteers can be placed.",
      due: f.startsOn ? `Due ${formatDate(twoWeeksBefore(f.startsOn), { year: undefined })}` : undefined,
      // The stops are set in each job; their order has its own tab.
      href: `${base}/volunteering?station=order`,
      done: f.checkInStops > 0,
      required: false,
    });
  }
  if (groups) {
    // A band contest opens registration when it publishes: no separate step for it.
    if (f.eventType !== "band_contest")
      after.push({
        id: "registration",
        label: `Open ${words.one} registration`,
        hint: `So ${words.one} directors can register.`,
        href: `${base}/bands`,
        done: f.published && f.bandRegistrationOpen,
        required: false,
      });
    after.push(
      {
        id: "schedule",
        label: hasRooms(f.eventType) ? "Build and post the room schedule" : "Build and publish the performance schedule",
        hint:
          f.eventType === "band_contest"
            ? "Directors are emailed their times when you publish it, so they can book buses."
            : "Directors are emailed their times when you publish the schedule.",
        due: f.eventType === "band_contest" && f.startsOn ? `Due ${formatDate(twoWeeksBefore(f.startsOn), { year: undefined })}` : undefined,
        href: hasRooms(f.eventType) ? `${base}/rooms#order-heading` : `${base}/schedule`,
        done: f.scheduleShared,
        required: false,
        partial: f.scheduleSlots > 0 ? { fraction: 0.75, note: "Built, not published yet" } : undefined,
      },
    );
  }
  if (hasParents(f.eventType)) {
    after.push({
      id: "parents-open",
      label: "Open parent registration",
      hint: "Share the registration link or QR code with families.",
      href: `${base}/parents`,
      done: f.published && f.parentRegistrationOpen,
      required: false,
    });
  }

  // A live band contest: volunteer jobs still being finished belong with the after-publishing steps,
  // just before opening sign-up; finished ones simply drop out of "before".
  if (f.eventType === "band_contest" && f.published) {
    const jobs = before.findIndex((s) => s.id === "shifts");
    if (jobs >= 0) {
      const [step] = before.splice(jobs, 1);
      if (!step.done && f.stations > 0) {
        const at = after.findIndex((s) => s.id === "signup");
        after.splice(at < 0 ? 0 : at, 0, { ...step, label: "Finish volunteer jobs" });
      }
    }
  }
  before.sort((a, b) => BEFORE_ORDER.indexOf(a.id) - BEFORE_ORDER.indexOf(b.id));
  // Only open steps can be part-way; a finished one just shows done.
  for (const st of [...before, ...after]) if (st.done) delete st.partial;
  const all = [...before, publish, ...after];
  const remaining = before.filter((s) => s.required && !s.done);
  const needed = [...before.filter((s) => s.required), publish];
  const afterDone = after.filter((s) => s.done).length;
  const next = !f.published ? (remaining[0] ?? publish) : (after.find((s) => !s.done) ?? null);
  const counted = f.published ? after : needed;
  // Before publishing, only a step publishing needs can be "in progress" ahead of Publish: an optional one never jumps the queue.
  const inProgress = (f.published ? after : before.filter((s) => s.required)).find((s) => !s.done && s.partial) ?? null;
  return {
    eventId: f.eventId,
    inProgress,
    // The line fills from the left (done first, then part-way), and fills up once everything needed is in place.
    segments: [...counted]
      .sort((a, b) => rank(a) - rank(b))
      .map((s) => {
        const full = s.done || (!f.published && remaining.length === 0);
        return { id: s.id, state: full ? "done" : s.partial ? "partial" : "todo", fraction: full ? 1 : (s.partial?.fraction ?? 0) };
      }),
    before,
    publish,
    after,
    remaining,
    doneCount: all.filter((s) => s.done).length,
    total: all.length,
    next,
    progress: f.published
      ? { label: after.length ? `Live · ${afterDone} of ${after.length} done` : "Live", done: afterDone, of: after.length || 1 }
      : remaining.length
        ? {
            label: `${needed.filter((s) => s.done).length} of ${needed.length} needed to publish`,
            done: needed.filter((s) => s.done).length,
            of: needed.length,
          }
        : // Everything needed is in place: a full line, with Publish as the next step.
          { label: "Ready to publish", done: 1, of: 1 },
    // A live event with a job volunteers can't see yet isn't finished: the event page says which.
    complete: f.published && afterDone === after.length && !(f.emptyJobs ?? []).length,
  };
}

/** Two weeks before a day (YYYY-MM-DD): when a band contest's times and stops should be set. */
export function twoWeeksBefore(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().slice(0, 10);
}

function rank(s: SetupStep) {
  return s.done ? 0 : s.partial ? 1 : 2;
}

/** What publishing changes for this event, in plain words (shown next to the Publish button). */
export function publishEffects(f: SetupFacts): string[] {
  const words = groupWords(f.eventType);
  const lines = ["Your public page goes online, so anyone with the link can see it."];
  if (isMeeting(f.eventType)) {
    return [
      ...lines,
      "Nobody is emailed or notified. People only find out when you share your link.",
      "You can keep editing everything, and unpublish at any time.",
    ];
  }
  if (hasConferences(f.eventType)) {
    return [
      ...lines,
      "Nobody is emailed or notified. Families only find out when you share your link.",
      "You can keep editing everything, and unpublish at any time.",
    ];
  }
  if (f.stations > 0 || f.eventType === "volunteer") {
    lines.push(
      f.volunteerSignupOpen
        ? "Volunteer sign-up opens right away (it was left on)."
        : "Volunteer sign-up stays closed until you open it.",
    );
  }
  if (f.eventType === "band_contest") {
    lines.push(
      f.registrationOpensOn
        ? `Band registration opens on ${formatDate(f.registrationOpensOn)}, and directors can register until your deadline. Before then, the registration page says when it opens.`
        : "Band registration opens, and directors can register until your deadline.",
    );
  } else if (hasEnsembles(f.eventType)) {
    lines.push(
      f.bandRegistrationOpen
        ? `${words.One} registration opens right away (it was left on).`
        : `${words.One} registration stays closed until you open it.`,
    );
  }
  if (hasParents(f.eventType)) {
    lines.push(
      f.parentRegistrationOpen
        ? "Parents can start registering right away."
        : "Parent registration stays closed until you open it.",
    );
  }
  if (hasBooths(f.eventType)) lines.push("Booths you've listed publicly appear on your event page.");
  lines.push("Nobody is emailed or notified. People only find out when you share your link.");
  lines.push("You can keep editing everything, and unpublish at any time.");
  return lines;
}
