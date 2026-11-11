import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";
import { formatDate } from "@/lib/time";
import { ActionButton } from "./forms";
import { setVolunteerSignupOpen } from "../../actions";

/**
 * A festival's event page (owner decisions and light check, 2026-11-11): one "Next step" card at the top,
 * then a card for each area, named like its setup step, with outline buttons. Drafts get one line per area
 * with its first action; the Event day card waits until the festival is live.
 */

export const BTN = "inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover";
export const BTN_OUTLINE = "inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** Everything the festival's cards say, worked out once on the page (L1: one fact, one source). */
export type FestivalFacts = {
  eventId: string;
  slug: string;
  /** The registration form's address to share, and to preview. */
  registrationUrl: string;
  previewHref: string;
  published: boolean;
  /** Registration open now (published, switched on, and its deadline not passed). */
  regOpen: boolean;
  /** Closed by hand before the deadline. */
  closedEarly: boolean;
  deadline: string | null;
  deadlinePast: boolean;
  /** Registered groups (withdrawn ones don't count), in registration order. */
  groups: { id: string; name: string }[];
  performers: number;
  maxGroups: number | null;
  classifications: number;
  /** Groups with times, and the ones still without (by name). */
  withTimes: number;
  noTimes: string[];
  posted: boolean;
  rooms: number;
  pathRooms: number;
  /** Minutes in each room on the path, added up (with the walking time between them). */
  minutesPerGroup: number;
  volunteers: {
    jobs: number;
    /** Shift spots and things to bring: filled, and how many there are. */
    filled: number;
    capacity: number;
    sentence: string;
    signupOpen: boolean;
    /** Jobs volunteers can't see yet (no shift or thing to bring). */
    notShowing: number;
  };
  dates: string;
  isEventDay: boolean;
  past: boolean;
  /** On the day: how the groups are getting on (from the team's marks). */
  dayLine: ReactNode;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (d: string) => formatDate(d, { year: undefined });

/** "Westbrook Middle School Choir", "A and B", "A, B, and 2 more". */
function names(list: string[]) {
  if (list.length <= 2) return list.join(" and ");
  if (list.length === 3) return `${list[0]}, ${list[1]}, and ${list[2]}`;
  return `${list[0]}, ${list[1]}, and ${list.length - 2} more`;
}

/** "N groups · N have times · not posted": the same words on the Next step card and the Rooms and schedule card. */
function timesLine(f: FestivalFacts) {
  return `${plural(f.groups.length, "group", "groups")} · ${f.withTimes} ${f.withTimes === 1 ? "has" : "have"} times · ${f.posted ? "posted" : "not posted"}`;
}

function regBadge(f: FestivalFacts) {
  if (f.regOpen) return <Badge tone="success">{f.deadline ? `Open through ${short(f.deadline)}` : "Open"}</Badge>;
  if (f.deadlinePast && f.deadline) return <Badge>Closed {short(f.deadline)}</Badge>;
  return <Badge>Closed early</Badge>;
}

/**
 * The one thing to do next on a live festival: share the registration link while it's open, then post the
 * schedule. Once the schedule is posted there's nothing waiting, so no card.
 */
export function FestivalNextStep({ f }: { f: FestivalFacts }) {
  if (f.regOpen) {
    return (
      <section id="share" aria-labelledby="next-heading" className="mt-6 scroll-mt-6 rounded-lg border-2 border-brand bg-surface p-4 shadow-card sm:p-6">
        <p className="text-sm font-semibold text-muted">Next step</p>
        <h2 id="next-heading" className="mt-1 text-xl font-semibold">
          Share the registration link
        </h2>
        <p className="mt-1 text-sm leading-6">
          <span className="font-semibold">
            {f.groups.length ? `${plural(f.groups.length, "group", "groups")} registered` : "No groups registered yet"}
            {f.deadline ? ` · open through ${short(f.deadline)}` : ""}.
          </span>{" "}
          Directors register from this link, no account needed. Once registration closes, you post the schedule.
        </p>
        <p className="mt-3 rounded-md bg-background px-3 py-2 font-mono text-sm break-all ring-1 ring-border">{f.registrationUrl.replace(/^https?:\/\//, "")}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <CopyLink url={f.registrationUrl} className={BTN} />
          <a href={f.previewHref} target="_blank" className={BTN_OUTLINE}>
            Preview the form<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </section>
    );
  }
  if (f.posted) return null;
  return (
    <section id="next" aria-labelledby="next-heading" className="mt-6 scroll-mt-6 rounded-lg border-2 border-brand bg-surface p-4 shadow-card sm:p-6">
      <p className="text-sm font-semibold text-muted">Next step</p>
      <h2 id="next-heading" className="mt-1 text-xl font-semibold">
        Post the schedule
      </h2>
      <p className="mt-1 text-sm leading-6">
        <span className="font-semibold">{timesLine(f)}.</span>{" "}
        {f.noTimes.length > 0 && f.withTimes > 0 && (
          <>
            {names(f.noTimes)} {f.noTimes.length === 1 ? "has" : "have"} no times yet.{" "}
          </>
        )}
        Posting emails each director their group&apos;s times and shows the schedule on the festival page.
      </p>
      <Link href={`/dashboard/events/${f.eventId}/rooms`} className={`${BTN} mt-4`}>
        Go to Rooms and schedule
      </Link>
    </section>
  );
}

/** A card named like its step, with its heading inside (the quick links jump to it). */
function AreaCard({ id, title, children, highlight = false }: { id: string; title: string; children: ReactNode; highlight?: boolean }) {
  return (
    <Card id={id} aria-labelledby={`${id}-heading`} role="region" className={`scroll-mt-6 ${highlight ? "border-brand" : ""}`}>
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Meter({ value, of, label }: { value: number; of: number; label: string }) {
  const pct = of ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <div
      className="mt-2 h-2.5 overflow-hidden rounded-full border border-border bg-background"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-brand"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A live festival's cards: Registration, Rooms and schedule, Volunteers, and Event day (first on the day). */
export function FestivalCards({ f, dayFirst }: { f: FestivalFacts; dayFirst: boolean }) {
  const base = `/dashboard/events/${f.eventId}`;
  const registered = f.groups.length;
  // Groups without times are named once others have times (a late registration), never all of them at once.
  const showNoTimes = f.noTimes.length > 0 && f.withTimes > 0;
  const registration = (
    <AreaCard key="registration" id="registration" title="Registration">
      <p className="mt-1 text-sm">{regBadge(f)}</p>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{plural(registered, "group", "groups")} registered</span>
        {f.maxGroups && <span className="text-muted">Limit {f.maxGroups}</span>}
      </div>
      {f.maxGroups && <Meter value={registered} of={f.maxGroups} label="Group spots taken" />}
      <p className="mt-1 text-sm text-muted">{plural(f.performers, "performer", "performers")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`${base}/bands`} className={BTN_OUTLINE}>
          Manage registration
        </Link>
        {f.regOpen && <CopyLink url={f.registrationUrl} label="Copy registration link" className={BTN_OUTLINE} />}
      </div>
    </AreaCard>
  );
  const rooms = (
    <AreaCard key="schedule" id="schedule" title="Rooms and schedule">
      <p className="mt-1 text-sm">{f.posted ? <Badge tone="success">Posted</Badge> : <Badge>Not posted</Badge>}</p>
      <div className="mt-3 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">
          {registered === 0 ? "No groups to schedule yet" : `${f.withTimes} of ${plural(registered, "group", "groups")} ${registered === 1 ? "has" : "have"} times`}
        </span>
        <span className="text-muted">{plural(f.rooms, "room", "rooms")}</span>
      </div>
      {registered > 0 && <Meter value={f.withTimes} of={registered} label="Groups with times" />}
      {showNoTimes && (
        <p className="mt-2 text-sm font-medium text-warning">
          <span aria-hidden>◆ </span>
          {names(f.noTimes)} {f.noTimes.length === 1 ? "has" : "have"} no times yet
        </p>
      )}
      <Link href={`${base}/rooms`} className={`${BTN_OUTLINE} mt-4`}>
        Manage rooms and schedule
      </Link>
    </AreaCard>
  );
  const v = f.volunteers;
  const volunteers = (
    <AreaCard key="volunteers" id="volunteers" title="Volunteers">
      {v.jobs === 0 ? (
        <p className="mt-1 text-sm text-muted">No jobs yet · Optional</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{v.signupOpen ? <Badge tone="success">Sign-up open</Badge> : <Badge>Sign-up closed</Badge>}</p>
          <div className="mt-3 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">{v.sentence}</span>
            <span className="text-muted">{Math.max(v.capacity - v.filled, 0)} open</span>
          </div>
          <Meter value={v.filled} of={v.capacity} label="Volunteer spots filled" />
          {v.notShowing > 0 && (
            <p className="mt-2 text-sm font-medium text-warning">
              <span aria-hidden>◆ </span>
              {v.notShowing === 1 ? "1 job isn't on the sign-up page yet" : `${v.notShowing} jobs aren't on the sign-up page yet`}
            </p>
          )}
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`${base}/volunteering`} className={BTN_OUTLINE}>
          {v.jobs === 0 ? "Add a job" : "Manage volunteers"}
        </Link>
        {/* Opening sign-up is a tap away; closing it is on the Volunteers page, away from home (owner, 2026-11-11). */}
        {v.jobs > 0 && v.capacity > 0 && !v.signupOpen && !f.past && (
          <ActionButton action={setVolunteerSignupOpen.bind(null, f.eventId, true)} variant="secondary" pendingText="Opening…">
            Open sign-up
          </ActionButton>
        )}
      </div>
    </AreaCard>
  );
  const day = (
    <AreaCard key="day" id="day" title="Event day" highlight={f.isEventDay}>
      <p className="mt-1 text-sm text-muted">{f.dates}</p>
      <div className="mt-3 text-sm leading-6">
        {f.dayLine ?? <p>Mark each group arrived and done in each room. Families follow along on the festival page.</p>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`${base}/event-day`} className={dayFirst ? BTN : BTN_OUTLINE}>
          Open Event day
        </Link>
        <Link href={`${base}/volunteers`} className={BTN_OUTLINE}>
          Volunteer check-in
        </Link>
      </div>
    </AreaCard>
  );
  return <div className="mt-6 grid gap-4 lg:grid-cols-2">{dayFirst ? [day, registration, rooms, volunteers] : [registration, rooms, volunteers, day]}</div>;
}

/**
 * A draft festival's areas under the Publish card: one line each, with its first action as an outline
 * button (the Publish card has the one main button). Kept once it's ready to publish.
 */
export function FestivalDraftCards({ f }: { f: FestivalFacts }) {
  const base = `/dashboard/events/${f.eventId}`;
  const outside = f.rooms - f.pathRooms;
  const hours = f.minutesPerGroup >= 60 ? `about ${Math.round(f.minutesPerGroup / 30) / 2} ${f.minutesPerGroup >= 90 ? "hours" : "hour"} per group` : `about ${f.minutesPerGroup} minutes per group`;
  const cards: { id: string; title: string; line: string; button: { label: string; href: string } }[] = [
    {
      id: "schedule",
      title: "Rooms and schedule",
      line:
        f.rooms === 0
          ? "No rooms yet"
          : f.pathRooms === 0
            ? `${plural(f.rooms, "room", "rooms")}, none in the rotation yet`
            : `${plural(f.pathRooms, "room", "rooms")}${outside > 0 ? ` and ${outside} outside the rotation` : ""}${f.minutesPerGroup > 0 ? ` · ${hours}` : ""}`,
      button: f.rooms === 0 ? { label: "Add a room", href: `${base}/rooms` } : { label: "Change rooms", href: `${base}/rooms` },
    },
    {
      id: "registration",
      title: "Registration",
      line: `${f.deadline ? `Closes ${short(f.deadline)}` : "No deadline yet"} · ${f.classifications ? plural(f.classifications, "classification", "classifications") : "no classifications"}${f.maxGroups ? ` · limit ${f.maxGroups} groups` : ""}`,
      button: f.deadline ? { label: "Change registration", href: `${base}/bands` } : { label: "Add a deadline", href: `${base}/bands` },
    },
    {
      id: "volunteers",
      title: "Volunteers",
      line: f.volunteers.jobs === 0 ? "No jobs yet · Optional" : `${plural(f.volunteers.jobs, "job", "jobs")} · ${f.volunteers.sentence}`,
      button: f.volunteers.jobs === 0 ? { label: "Add a job", href: `${base}/volunteering` } : { label: "Change jobs", href: `${base}/volunteering` },
    },
  ];
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      {cards.map((c) => (
        <AreaCard key={c.id} id={c.id} title={c.title}>
          <p className="mt-1 text-sm text-muted">{c.line}</p>
          <Link href={c.button.href} className={`${BTN_OUTLINE} mt-3`}>
            {c.button.label}
          </Link>
        </AreaCard>
      ))}
    </div>
  );
}
