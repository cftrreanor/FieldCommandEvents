/**
 * The setup steps of an event before it's published, shared by the server layout (which pages hide
 * the setup strip) and the steps along the top (a client component).
 */

/** Each kind of event's setup steps, and where each one lives under the event. */
export const SETUP_STEPS = {
  volunteer: [
    { key: "details", label: "Details", path: "/edit", optional: false },
    { key: "jobs", label: "Jobs and shifts", path: "/volunteering", optional: false },
    { key: "publish", label: "Publish", path: "", optional: false },
  ],
  // A band contest: what directors need to register, volunteers if it has them (never blocks), then publishing opens registration.
  band: [
    { key: "details", label: "Details", path: "/edit", optional: false },
    { key: "registration", label: "Band registration", path: "/bands", optional: false },
    { key: "volunteers", label: "Jobs and shifts", path: "/volunteering", optional: true },
    { key: "publish", label: "Publish", path: "", optional: false },
  ],
  // Meetings and parent-teacher conferences: the basics are enough to publish; the extras (every
  // week, phone calls, breaks, time between meetings) wait in an optional step (decisions 2026-11-07).
  meeting: [
    { key: "details", label: "Details", path: "/edit", optional: false },
    { key: "times", label: "Meeting times", path: "/conferences/times", optional: false },
    { key: "place", label: "Where you'll meet", path: "/conferences/place", optional: false },
    { key: "options", label: "More options", path: "/conferences/options", optional: true },
    { key: "publish", label: "Publish", path: "", optional: false },
  ],
} as const;
export type StepsKind = keyof typeof SETUP_STEPS;

/** The pages that show the steps (every other page keeps the setup strip). */
export const STEP_PATHS: Record<StepsKind, string[]> = {
  volunteer: SETUP_STEPS.volunteer.map((s) => s.path),
  band: SETUP_STEPS.band.map((s) => s.path),
  meeting: SETUP_STEPS.meeting.map((s) => s.path),
};

export type SetupStepFacts = {
  /** The middle step is done (a job volunteers can see; what directors need to register). */
  middleDone: boolean;
  /** A band contest's optional Volunteers step: done once a job volunteers can see has something to sign up for. */
  volunteersDone?: boolean;
  /** What the Volunteers step says when it isn't done ("Optional", "Check-in table needs a shift"). */
  volunteersNote?: string | null;
  /** What the middle step still needs, when it isn't done ("Litter pickup needs a shift"). */
  middleNote: string | null;
  /** Shown beside the middle step's name ("3 jobs"). */
  count: string | null;
  /** Steps with more than one middle step (meetings): each step's own done and note, by key. */
  done?: Partial<Record<string, boolean>>;
  notes?: Partial<Record<string, string | null>>;
  /** Steps this event doesn't have (a one-day meetings event has no More options: owner, 2026-11-09). */
  skip?: string[];
};

