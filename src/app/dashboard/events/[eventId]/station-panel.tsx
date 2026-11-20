import { Badge, Card } from "@/components/ui";
import { VolunteerTags } from "@/components/volunteer-tags";
import { kindLabel, type CheckpointKind } from "@/lib/contest-day";
import { hasBands, leadWords } from "@/lib/event-types";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatDateRange, formatTime, formatTimeRange, utcToZonedDate, utcToZonedTime } from "@/lib/time";
import {
  createItem,
  createShift,
  deleteItem,
  deleteShift,
  deleteStation,
  generateShifts,
  removeItemSignup,
  updateItem,
  updateShift,
  updateStation,
} from "../../actions";
import { BuildShifts, DeleteButton, ItemsEditor, ShiftForm, StationForm, type LeadOption } from "./forms";
import { inviteCoordinator } from "../../team-actions";
import { JobKindSwitch, type JobFacts } from "./volunteering/job-parts";
import { JobForm } from "./volunteering/job-form";

export type Shift = {
  id: string;
  station_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  registered_count: number;
  /** Who can take it (after the 20270102000000 update). */
  adults_only?: boolean;
  min_age?: number | null;
};

export type Station = {
  id: string;
  name: string;
  checkpoint_kind: CheckpointKind | null;
  checkpoint_order: number | null;
  due_minutes_before_warm_up: number | null;
  location: string | null;
  instructions: string | null;
  adults_only?: boolean;
  /** Spots on each shift held for volunteers 18 or older (after the 20270110000000 update). */
  min_adults?: number | null;
  zone?: string | null;
  lead_user_id: string | null;
  /** Everyone leading this sign-up, first-added first. */
  lead_ids: string[];
  /** Volunteers can see it (a volunteer event's jobs start hidden; after the 20270105000000 update). */
  showing?: boolean;
  /** When "1. Sign-up details" was last saved (null: not done yet). */
  details_saved_at?: string | null;
  /** Time slots (shifts) or things to bring (items). */
  signup_kind?: "shifts" | "items";
};

/** One thing an items sign-up needs (Desserts, 6 needed). */
export type StationItem = { id: string; station_id: string; name: string; needed: number; claimed_count: number };

/** Who's bringing what, for the event's volunteer managers. */
export type ItemSignup = { id: string; item_id: string; note: string | null; volunteer_name: string; email: string | null; phone: string | null };

export type RosterEntry = {
  assignment_id: string;
  shift_id: string;
  volunteer_name: string;
  email: string | null;
  phone: string | null;
  checked_in_at: string | null;
  contact_locked: boolean;
  /** Under 18 / a student: their phone is a guardian's. */
  minor?: boolean;
  /** Who signed them up, if someone else did. */
  signed_up_by?: string | null;
  /** A minor whose parent or guardian confirmed at sign-up (after the 20270102000000 update). */
  guardian_confirmed?: boolean;
};

/**
 * One station: its shifts (with editing for organizers), and for the sign-up's
 * lead, who's signed up. Used on the Volunteer Setup tabs and, for
 * Coordinators, on the event page.
 */
export function StationPanel({
  eventId,
  station,
  stationShifts,
  event,
  days,
  windowLabel,
  windowTimes,
  userId,
  canManage,
  leadNames,
  roster,
  locations = [],
  zones,
  items = [],
  itemSignups,
  kindLocked = null,
  leadOptions = [],
  pendingInvites = [],
  heldInvites = [],
  teamHref,
  job,
  adultsNeeded = {},
  newDateShifts = [],
}: {
  eventId: string;
  station: Station;
  stationShifts: Shift[];
  /** A copy: the start times ("10:30 AM") of this job's shifts listed as "[new date]" places (marked or too long to mark). */
  newDateShifts?: string[];
  event: { timezone: string; starts_on: string; ends_on: string; event_type?: string };
  days: string[];
  windowLabel: string;
  /** How long the event day is, in minutes. */
  /** The event day's start and end ("07:00", "21:00"), where Fill the day starts out. */
  windowTimes?: { start: string; end: string };
  userId: string;
  canManage: boolean;
  leadNames: string[];
  /** A group event's rooms, suggested for a sign-up's location. */
  locations?: string[];
  /** A fair's zones, suggested for a sign-up's zone. */
  zones?: readonly string[];
  /** Only for the sign-up's lead: who has signed up. */
  roster?: RosterEntry[];
  /** An items station: what it needs. */
  items?: StationItem[];
  /** An items station, for managers and its leads: who's bringing what. */
  itemSignups?: ItemSignup[];
  /** Why its type can't change right now (it has shifts or items, or it's a check-in stop). */
  kindLocked?: string | null;
  /** The team, to pick its Coordinators from. */
  leadOptions?: LeadOption[];
  /** Invited to lead it, not accepted yet. */
  pendingInvites?: string[];
  /** A duplicated draft's copied Coordinators for it, not emailed yet (Duplicate event). */
  heldInvites?: { name: string; expired: boolean }[];
  /** Team setup's Coordinators tab, where they're sent or removed. */
  teamHref?: string;
  /** A volunteer event's job: its own layout and words, saved as people type. */
  job?: JobFacts;
  /** Adults each shift still needs (its job saves spots for adults). */
  adultsNeeded?: Record<string, number>;
}) {
  const noun = job ? "job" : "sign-up";
  const itemsStation = station.signup_kind === "items";
  const tz = event.timezone;
  const multiDay = days.length > 1;
  const buildShifts = (
    <BuildShifts
      generate={generateShifts.bind(null, eventId, station.id)}
      create={createShift.bind(null, eventId, station.id)}
      windowLabel={windowLabel}
      windowTimes={windowTimes}
      days={days}
      existing={stationShifts.length}
      signedUp={stationShifts.some((s) => s.registered_count > 0)}
      job={Boolean(job)}
      minAdults={station.adults_only ? null : station.min_adults}
    />
  );
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{station.name}</h3>
            {station.checkpoint_kind && (
              <Badge tone="info">
                {job?.stops
                  ? `Stop ${station.checkpoint_order} of ${job.stops} · ${kindLabel(station.checkpoint_kind)}`
                  : `Check-in stop ${station.checkpoint_order} · ${kindLabel(station.checkpoint_kind)}`}
              </Badge>
            )}
            {station.adults_only && <Badge>Adults only (18+)</Badge>}
            {station.lead_ids.includes(userId) && <Badge tone="brand">You lead this</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[
              // A volunteer event's jobs meet at the event's address.
              job ? null : station.location,
              leadNames.length
                ? `${job ? (leadNames.length > 1 ? "Coordinators" : "Coordinator") : leadNames.length > 1 ? "Leads" : "Lead"}: ${leadNames.join(", ")}`
                : canManage && heldInvites.length
                  ? // A copied Coordinator held for publishing: named, as on the job's chips.
                    `${heldInvites.length > 1 ? "Coordinators" : "Coordinator"}: ${heldInvites.map((h) => `${h.name} · ${h.expired ? "invitation expired" : "not emailed yet"}`).join(", ")}`
                  : canManage
                    ? job ? "No Coordinator yet" : "No lead yet"
                    : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {canManage && (
        // Everything about the sign-up in one place: its name, type, details, and Coordinators (one Save),
        // then its items or time slots, edited right in their rows.
        <div className={job ? "mt-4 space-y-5" : "mt-5 space-y-8"}>
          {/* A volunteer event's job starts with what volunteers sign up for: shifts or things to bring. */}
          {job && <JobKindSwitch eventId={eventId} stationId={station.id} kind={itemsStation ? "items" : "shifts"} locked={kindLocked} />}
          <div id="station-details" className="scroll-mt-6">
            {job ? (
              <JobForm
                action={updateStation.bind(null, eventId, station.id)}
                remove={deleteStation.bind(null, eventId, station.id)}
                initial={station}
                leadLabel={leadWords(event.event_type).many}
                coordinators={{ options: leadOptions, pending: pendingInvites, held: heldInvites, teamHref, invite: inviteCoordinator.bind(null, eventId, station.id) }}
                links={job.links}
                signedUp={stationShifts.some((x) => x.registered_count > 0) || (items ?? []).some((x) => x.claimed_count > 0)}
                ready={job.ready}
                allReady={job.allReady}
                items={job.items}
                bands={hasBands(event.event_type)}
                openMore={job.openMore}
              />
            ) : (
            <StationForm
              action={updateStation.bind(null, eventId, station.id)}
              initial={station}
              submitLabel={`Save ${noun}`}
              bands={hasBands(event.event_type)}
              locations={locations}
              zones={zones}
              leadLabel={leadWords(event.event_type).many}
              kind={{ value: station.signup_kind ?? "shifts", locked: kindLocked }}
              coordinators={{ options: leadOptions, pending: pendingInvites, held: heldInvites, teamHref, invite: inviteCoordinator.bind(null, eventId, station.id) }}
              trackUnsaved
              draft={!station.details_saved_at}
              remaining={[
                ...(station.details_saved_at ? [] : ["finish the details"]),
                ...(itemsStation
                  ? items.length ? [] : [job ? "add things to bring" : "add items to bring"]
                  : stationShifts.length ? [] : [job ? "add shifts" : "add time slots"]),
              ]}
            />
            )}
          </div>
          {itemsStation ? (
            <section id="items" aria-labelledby="items-heading" className={`scroll-mt-6 border-t border-border ${job ? "pt-4" : "pt-6"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 id="items-heading" className="text-base font-semibold">
                  {job ? "Things to bring" : "Items to bring"}
                </h4>
                <p className="text-sm text-muted">Sign-ups stop when an item is covered</p>
              </div>
              <div className="mt-3">
                <ItemsEditor
                  autosave={Boolean(job)}
                  create={createItem.bind(null, eventId, station.id)}
                  items={items.map((it) => ({
                    ...it,
                    update: updateItem.bind(null, eventId, it.id),
                    remove: deleteItem.bind(null, eventId, it.id),
                  }))}
                />
              </div>
            </section>
          ) : (
            <section id="build-shifts" aria-labelledby="shifts-heading" className={`scroll-mt-6 border-t border-border ${job ? "pt-4" : "pt-6"}`}>
              <h4 id="shifts-heading" className="text-base font-semibold">
                {job ? "Shifts" : "Time slots"}
              </h4>
              <ShiftList shifts={stationShifts} eventId={eventId} tz={tz} multiDay={multiDay} days={days} canManage job={Boolean(job)} adultsNeeded={adultsNeeded} newDateShifts={newDateShifts} />
              {stationShifts.length > 0 ? (
                // Once it has time slots, redoing or adding them is tucked away so it doesn't pull focus.
                <details className="group mt-3">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted hover:text-foreground">
                    <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                      ›
                    </span>
                    {job ? "Add more shifts" : "Redo or add shifts"}
                  </summary>
                  <div className="mt-2">
                    {buildShifts}
                  </div>
                </details>
              ) : (
                <div className="mt-4">
                  {buildShifts}
                </div>
              )}
            </section>
          )}
          {/* A job's "More options" (Coordinators, instructions, adults only) is drawn here, after its shifts or things to bring. */}
          {job && <div id="job-more" />}
        </div>
      )}
      {/* A volunteer event's job lists its sign-ups below the page's daily summary instead (JobSignups). */}
      {!job &&
        (itemsStation ? (
          <ItemsBoard items={items} signups={itemSignups} eventId={eventId} canManage={canManage} />
        ) : (
          !canManage && (
            <>
              <h4 className="mt-6 text-sm font-semibold">Shift schedule</h4>
              <ShiftList shifts={stationShifts} eventId={eventId} tz={tz} multiDay={multiDay} days={days} canManage={false} adultsNeeded={adultsNeeded} />
            </>
          )
        ))}
      {!job && roster && !itemsStation && <RosterList roster={roster} shifts={stationShifts} tz={tz} event={event} canManage={canManage} />}

      {/* A job's Delete is in its pinned bar. */}
      {canManage && !job && (
        <div className="mt-8 border-t border-border pt-4">
          <DeleteButton
            action={deleteStation.bind(null, eventId, station.id)}
            label={`Delete ${noun} ${station.name}`}
            text={`Delete ${noun}`}
            quiet
            confirmMessage={`Delete “${station.name}”? Its ${job ? "shifts" : "time slots"} and items are deleted too, and this can't be undone. (A ${noun} with people signed up can't be deleted.)`}
          />
        </div>
      )}
      {canManage && (
        // The sign-up's footer (its save bar) renders here: pinned to the bottom of the screen until the card ends.
        <div id="signup-bar" className="sticky bottom-[var(--day-bar,0px)] z-10 -mx-4 -mb-4 mt-6 sm:-mx-6 sm:-mb-6" />
      )}
    </Card>
  );
}

/** Who's signed up for a sign-up's shifts, with their shift, who booked them, and (on event day) their phone. */
function RosterList({
  roster,
  shifts,
  tz,
  event,
  canManage,
  heading = true,
}: {
  roster: RosterEntry[];
  shifts: Shift[];
  tz: string;
  event: { starts_on: string; ends_on: string };
  canManage: boolean;
  heading?: boolean;
}) {
  return (
        <div className="mt-6">
          {heading && <h4 className="text-sm font-semibold">{canManage ? "Who's signed up" : "Your volunteers"}</h4>}
          {roster.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No one has signed up yet.</p>
          ) : (
            <>
              {roster[0].contact_locked && (
                <p className="mt-1 text-sm text-muted">
                  Phone numbers and emails unlock on event day ({formatDateRange(event.starts_on, event.ends_on)}).
                </p>
              )}
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {roster.map((v) => {
                  const shift = shifts.find((s) => s.id === v.shift_id);
                  return (
                    <li key={v.assignment_id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {v.volunteer_name}
                          <VolunteerTags minor={v.minor} guardianConfirmed={v.guardian_confirmed} />
                        </p>
                        {shift && <p className="truncate text-sm text-muted">{formatTimeRange(shift.starts_at, shift.ends_at, tz)}</p>}
                        {v.signed_up_by && <p className="truncate text-sm text-muted">Booked by {v.signed_up_by}</p>}
                        {v.phone && (
                          <a href={`tel:${v.phone}`} className="text-sm font-medium text-brand hover:underline">
                            {formatPhone(v.phone)}
                          </a>
                        )}
                      </div>
                      <span className="shrink-0 text-sm">
                        {v.checked_in_at ? "✓ Arrived" : <span className="text-muted">Not checked in</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
  );
}

/**
 * A volunteer event's job: who's signed up for its shifts, or who's bringing what. Shown on
 * Volunteer jobs below the daily summary, so the job's own card is just for setting it up.
 */
export function JobSignups({
  station,
  shifts,
  items,
  itemSignups,
  roster,
  event,
  eventId,
}: {
  station: Station;
  shifts: Shift[];
  items: StationItem[];
  itemSignups?: ItemSignup[];
  roster?: RosterEntry[];
  event: { timezone: string; starts_on: string; ends_on: string };
  eventId: string;
}) {
  return (
    <section id="signed-up" aria-labelledby="signed-up-heading" className="mt-6 scroll-mt-6 rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 id="signed-up-heading" className="text-lg font-semibold">
        {station.signup_kind === "items" ? "Who's bringing what" : "Who's signed up"}: {station.name}
      </h2>
      {station.signup_kind === "items" ? (
        <ItemsBoard items={items} signups={itemSignups} eventId={eventId} canManage heading={false} />
      ) : shifts.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Add a shift first. People who sign up for it show here.</p>
      ) : (
        roster && <RosterList roster={roster} shifts={shifts} tz={event.timezone} event={event} canManage heading={false} />
      )}
    </section>
  );
}

/** A sign-up's time slots: when, how full, and (for organizers) edit or delete each one. */
function ShiftList({
  shifts,
  eventId,
  tz,
  multiDay,
  days,
  canManage,
  job = false,
  adultsNeeded = {},
  newDateShifts = [],
}: {
  shifts: Shift[];
  job?: boolean;
  newDateShifts?: string[];
  /** Adults each shift still needs (its job saves spots for adults). */
  adultsNeeded?: Record<string, number>;
  eventId: string;
  tz: string;
  multiDay: boolean;
  days: string[];
  canManage: boolean;
}) {
  if (shifts.length === 0) return <p className="mt-2 text-sm text-muted">{job ? "No shifts yet. Add at least one so volunteers can sign up." : "No time slots yet."}</p>;
  return (
    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
      {shifts.map((s) => (
        <li key={s.id} className="px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            {job ? (
              // A job's shift leads with its time; a name of its own (not just "Shift") follows.
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {multiDay && `${formatDate(utcToZonedDate(s.starts_at, tz), { year: undefined })} · `}
                  {formatTimeRange(s.starts_at, s.ends_at, tz)}
                  {(s.adults_only || s.min_age) && (
                    <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold ring-1 ring-border">
                      {s.adults_only ? "Adults only" : `Ages ${s.min_age}+`}
                    </span>
                  )}
                </p>
                {!/^shift\b/i.test(s.title.trim()) && <p className="truncate text-sm text-muted">{s.title}</p>}
              </div>
            ) : (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {s.title}
                {(s.adults_only || s.min_age) && (
                  <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-semibold ring-1 ring-border">
                    {s.adults_only ? "Adults only" : `Ages ${s.min_age}+`}
                  </span>
                )}
              </p>
              <p className="text-sm text-muted">
                {multiDay && `${formatDate(utcToZonedDate(s.starts_at, tz), { year: undefined })} · `}
                {formatTimeRange(s.starts_at, s.ends_at, tz)}
              </p>
            </div>
            )}
            <div className="flex shrink-0 items-center gap-1">
              <span className="mr-1 text-right text-sm tabular-nums text-muted">
                {s.registered_count} of {s.max_capacity} filled
                {(adultsNeeded[s.id] ?? 0) > 0 && (
                  <span className="block font-medium text-warning">
                    <span aria-hidden>◆ </span>
                    needs {adultsNeeded[s.id]} more adult{adultsNeeded[s.id] === 1 ? "" : "s"}
                  </span>
                )}
              </span>
              {/* A job's shift with people on it can't be deleted, so it doesn't offer to. */}
              {canManage && !(job && s.registered_count > 0) && (
                <DeleteButton action={deleteShift.bind(null, eventId, s.id)} label={`Delete shift ${s.title}`} confirmMessage={`Delete “${s.title}”?`} />
              )}
            </div>
          </div>
          {canManage && (
            // Open when a copied shift's name or duties still hold "[new date]", so it's in sight.
            <details
              className="mt-1"
              open={`${s.title} ${s.description ?? ""}`.includes("[new date]") || newDateShifts.includes(formatTime(s.starts_at, tz).replace(/\s/g, " ")) || undefined}
            >
              <summary className={`inline-flex min-h-11 cursor-pointer items-center text-sm font-medium ${job ? "text-brand underline underline-offset-4" : "text-muted hover:text-foreground"}`}>
                {job ? "Edit shift" : "Edit time slot"}
              </summary>
              <div className="mt-3 pb-1">
                <ShiftForm
                  place={{ stationId: s.station_id, detail: formatTime(s.starts_at, tz).replace(/\s/g, " ") }}
                  action={updateShift.bind(null, eventId, s.id)}
                  days={days}
                  registered={s.registered_count}
                  submitLabel={job ? "Save shift" : "Save time slot"}
                  initial={{
                    title: s.title,
                    day: utcToZonedDate(s.starts_at, tz),
                    startTime: utcToZonedTime(s.starts_at, tz),
                    endTime: utcToZonedTime(s.ends_at, tz),
                    capacity: s.max_capacity,
                    description: s.description,
                    adultsOnly: s.adults_only ?? false,
                    minAge: s.min_age ?? null,
                  }}
                />
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}

/** An items station: each item, how many are coming, and who's bringing what (with their note). */
function ItemsBoard({
  items,
  signups,
  eventId,
  canManage,
  heading = true,
}: {
  items: StationItem[];
  signups?: ItemSignup[];
  eventId: string;
  canManage: boolean;
  /** Its own "Who's bringing what" heading (off when the section around it has one). */
  heading?: boolean;
}) {
  return (
    <>
      {heading && <h4 className="mt-6 text-sm font-semibold">Who&apos;s bringing what</h4>}
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No items yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {items.map((it) => {
            const people = (signups ?? []).filter((s) => s.item_id === it.id);
            return (
              <li key={it.id} className="px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{it.name}</p>
                  <span className="text-sm tabular-nums text-muted">
                    {it.claimed_count} / {it.needed} coming
                  </span>
                </div>
                {signups && people.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {people.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{p.volunteer_name}</span>
                          {p.note && <span className="text-muted"> · {p.note}</span>}
                          {(p.email || p.phone) && (
                            <span className="block text-muted">{[p.email, formatPhone(p.phone)].filter(Boolean).join(" · ")}</span>
                          )}
                        </span>
                        {canManage && (
                          <DeleteButton
                            action={removeItemSignup.bind(null, eventId, p.id)}
                            label={`Take ${p.volunteer_name} off ${it.name}`}
                            text="Remove"
                            confirmMessage={`Take ${p.volunteer_name} off “${it.name}”? Their spot opens up again. We don't email them, so let them know.`}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
