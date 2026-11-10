import "server-only";
import { loadTiers } from "@/lib/package-names";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { REMOVED_RECENTLY_DAYS } from "@/lib/team-words";
import { utcToZonedDate } from "@/lib/time";

// Everything My team shows, worked out once (docs/design-lessons.md, L1). What each person
// may read is limited by the database; this only arranges it.

export type StaffRole = "volunteer_director" | "section_lead";
export type Profile = { full_name: string; email: string; phone: string | null };
export type TeamEvent = { id: string; name: string; starts_on: string; ends_on: string; timezone: string; ended: boolean };

/** One role someone has on one event. */
export type RoleOn = {
  event: TeamEvent;
  role: StaffRole;
  /** The jobs they lead (Coordinators). */
  jobs: string[];
  /** Jobs nobody else leads: they'll need a new Coordinator. */
  soleJobs: string[];
  /** The event's only Volunteer Lead. */
  soleLead: boolean;
};
export type Person = { userId: string; profile: Profile; roles: RoleOn[] };
export type Invite = {
  id: string;
  email: string;
  role: StaffRole | null;
  asHost: boolean;
  event: TeamEvent | null;
  job: string | null;
  link: string;
  sentAt: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};
export type Removal = {
  id: string;
  role: "co_host" | StaffRole;
  email: string;
  name: string;
  event: TeamEvent | null;
  removedAt: string;
  left: boolean;
  /** You removed them in the last few minutes: until when Undo puts them back. */
  undoUntil: string | null;
};

/** How long Undo stays offered after removing someone. */
export const UNDO_MINUTES = 10;

/** An open offer of the Account Host role. */
/** Dates are calendar days in the account's time zone ("2026-11-21"). */
export type HostOffer = { userId: string; name: string; offeredOn: string; expiresOn: string };
/** How your last offer of the Account Host role ended, for a week afterward. */
export type OfferOutcome = { name: string; outcome: "accepted" | "declined" | "expired" | "left" | "ended"; on: string };
export type Spots = {
  used: number;
  invited: number;
  max: number | null;
  plan: string | null;
  eventStaff: boolean;
  /** The smallest package with more team spots, and the smallest with Volunteer Leads and Coordinators. */
  bigger: string | null;
  withStaff: string | null;
};
export type Host = { userId: string; role: "owner" | "admin"; profile: Profile };
/** Your own role on someone else's event (or your own, as a Volunteer Lead or Coordinator). */
export type MyRole = RoleOn & {
  accountHost: { name: string; email: string } | null;
  /** The event's Volunteer Leads (other than you): who a Coordinator asks on the day. */
  leads: { name: string; email: string }[];
};

/** A job on an upcoming event, for giving a Coordinator one when inviting them. */
export type Job = { id: string; name: string; led: boolean };
export type EventJobs = Record<string, Job[]>;

export type HostView = {
  /** The Account Host's open offer of their role to a co-host, if any. */
  offer: HostOffer | null;
  /** An open offer of the Account Host role to you (a co-host), with its link. */
  offerToMe: { token: string; from: string; expiresOn: string } | null;
  /** Your last offer's outcome (accepted, declined, expired, or ended because they left). */
  lastOffer: OfferOutcome | null;
  /** Each upcoming event's jobs. */
  jobs: EventJobs;
  /** Jobs left with no Coordinator after one left or was removed in the last 30 days. */
  gaps: { event: TeamEvent; gone: Removal; open: string[] }[];
  kind: "host";
  org: { id: string; name: string };
  isAccountHost: boolean;
  accountHost: Host | null;
  hosts: Host[];
  coHostInvites: Invite[];
  /** Volunteer Leads and Coordinators on events that aren't over. */
  people: Person[];
  /** Invitations to events that aren't over. */
  eventInvites: Invite[];
  /** Helpers whose events are all over: they don't hold a spot. */
  past: Person[];
  removed: Removal[];
  /** Events that aren't over, for adding people. */
  upcoming: TeamEvent[];
  spots: Spots;
};
export type LeadView = {
  kind: "lead";
  /** Events where you're a Volunteer Lead, with their Coordinators. */
  events: { event: TeamEvent; coordinators: Person[]; invites: Invite[] }[];
  removed: Removal[];
  /** The account's team is full: inviting needs a spot freed first. */
  full: boolean;
  /** Who frees one: the Account Host. */
  accountHost: string | null;
  jobs: EventJobs;
};
/** An account you're on: as its Account Host, a co-host, or on one of its event teams. */
export type TeamAccount = {
  id: string;
  name: string;
  role: "owner" | "admin" | "team";
  /** For an event-team account: your roles there ("Volunteer Lead", "Coordinator"). */
  label?: string;
};
export type MyTeam = {
  me: string;
  /** Every account you're on, the ones you own first. */
  accounts: TeamAccount[];
  /** The account shown (picked from the menu, or the first). */
  current: TeamAccount | null;
  host: HostView | null;
  lead: LeadView | null;
  myRoles: MyRole[];
};

type EventRow = { id: string; name: string; starts_on: string; ends_on: string; timezone: string };
type StaffRow = { user_id: string; role: StaffRole; event_id: string; profiles: Profile | null };
type LeadRow = { user_id: string; event_id: string; stations: { name: string } | null };
type InviteRow = {
  id: string;
  email: string;
  role: StaffRole | null;
  as_host: boolean;
  event_id: string | null;
  token: string;
  created_at: string;
  sent_at: string | null;
  expires_at: string;
  stations: { name: string } | null;
};
type RemovalRow = {
  id: string;
  role: "co_host" | StaffRole;
  user_id: string;
  email: string;
  full_name: string;
  removed_by: string | null;
  removed_at: string;
  event_id: string | null;
};

const NO_PROFILE: Profile = { full_name: "", email: "", phone: null };
export const personName = (p: Profile) => p.full_name || p.email || "Team member";

/** Over once its last day has passed where it's held. */
function toEvent(e: EventRow): TeamEvent {
  const today = utcToZonedDate(new Date().toISOString(), e.timezone || "America/Chicago");
  return { ...e, ended: e.ends_on < today };
}

const byStart = (a: { event: TeamEvent }, b: { event: TeamEvent }) => a.event.starts_on.localeCompare(b.event.starts_on);
const byName = (a: Person, b: Person) => personName(a.profile).localeCompare(personName(b.profile));

/** Each person once, with every role they have, and what removing them would leave empty. */
function groupPeople(staff: StaffRow[], leads: LeadRow[], events: Map<string, TeamEvent>): Person[] {
  // Counted once, then looked up: who leads what, and how many lead each job and event.
  const key = (...parts: string[]) => parts.join(":");
  const ledBy = new Map<string, string[]>();
  const leadersOfJob = new Map<string, number>();
  for (const l of leads) {
    const job = l.stations?.name ?? "";
    ledBy.set(key(l.user_id, l.event_id), [...(ledBy.get(key(l.user_id, l.event_id)) ?? []), job]);
    leadersOfJob.set(key(l.event_id, job), (leadersOfJob.get(key(l.event_id, job)) ?? 0) + 1);
  }
  const directorsOf = new Map<string, number>();
  for (const s of staff) if (s.role === "volunteer_director") directorsOf.set(s.event_id, (directorsOf.get(s.event_id) ?? 0) + 1);

  const people = new Map<string, Person>();
  for (const s of staff) {
    const event = events.get(s.event_id);
    if (!event) continue;
    const jobs = s.role === "section_lead" ? (ledBy.get(key(s.user_id, s.event_id)) ?? []).filter(Boolean) : [];
    const soleJobs = jobs.filter((job) => leadersOfJob.get(key(s.event_id, job)) === 1);
    const soleLead = s.role === "volunteer_director" && directorsOf.get(s.event_id) === 1;
    const person = people.get(s.user_id) ?? { userId: s.user_id, profile: s.profiles ?? NO_PROFILE, roles: [] };
    person.roles.push({ event, role: s.role, jobs, soleJobs, soleLead });
    people.set(s.user_id, person);
  }
  for (const p of people.values()) p.roles.sort(byStart);
  return [...people.values()].sort(byName);
}

function toInvite(i: InviteRow, events: Map<string, TeamEvent>, origin: string): Invite {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    asHost: i.as_host,
    event: i.event_id ? (events.get(i.event_id) ?? null) : null,
    job: i.stations?.name ?? null,
    link: `${origin}/invite/${i.token}`,
    sentAt: i.sent_at,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    expired: new Date(i.expires_at) < new Date(),
  };
}

/** Removed in the last 90 days, and not back on the team or invited again. */
function recentRemovals(rows: RemovalRow[], events: Map<string, TeamEvent>, back: (r: RemovalRow) => boolean, me: string): Removal[] {
  const undoFrom = Date.now() - UNDO_MINUTES * 60_000;
  const seen = new Set<string>();
  return rows
    .filter((r) => !back(r))
    .filter((r) => {
      // One row per person and role (the newest).
      const key = `${r.user_id}:${r.role}:${r.event_id ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      id: r.id,
      role: r.role,
      email: r.email,
      name: r.full_name || r.email,
      event: r.event_id ? (events.get(r.event_id) ?? null) : null,
      removedAt: r.removed_at,
      left: r.removed_by === r.user_id,
      undoUntil:
        r.removed_by === me && r.removed_by !== r.user_id && new Date(r.removed_at).getTime() >= undoFrom
          ? new Date(new Date(r.removed_at).getTime() + UNDO_MINUTES * 60_000).toISOString()
          : null,
    }));
}

/** A failed load never shows as an empty team: say a database update is needed, or show the error page. */
function check(results: { error: { code?: string; message: string } | null }[]) {
  const failed = results.find((r) => r.error)?.error;
  if (!failed) return;
  if (isSchemaError(failed)) missing();
  throw new Error(`My team couldn't load: ${failed.message}`);
}

const removedSince = () => new Date(Date.now() - REMOVED_RECENTLY_DAYS * 86_400_000).toISOString();

export async function loadMyTeam(userId: string, origin: string, accountId?: string | null): Promise<MyTeam> {
  const supabase = await createClient();
  const [membersRes, mineRes] = await Promise.all([
    supabase.from("organization_members").select("organization_id, role, organizations(name, default_timezone)").eq("user_id", userId),
    supabase
      .from("event_staff")
      .select("role, event_id, events(id, name, starts_on, ends_on, timezone, organization_id)")
      .eq("user_id", userId),
  ]);
  check([membersRes, mineRes]);
  const [memberData, mine] = [membersRes.data, mineRes.data];
  const memberships = (memberData ?? []) as unknown as {
    organization_id: string;
    role: "owner" | "admin";
    organizations: { name: string; default_timezone: string | null } | null;
  }[];
  const myStaff = ((mine ?? []) as unknown as { role: StaffRole; event_id: string; events: (EventRow & { organization_id: string }) | null }[]).filter(
    (s) => s.events && !toEvent(s.events).ended,
  );

  // Accounts where you're only on an event team: their names and Account Hosts (which you can't read yourself).
  const hostIds = new Set(memberships.map((m) => m.organization_id));
  const teamIds = [...new Set(myStaff.map((s) => s.events!.organization_id))].filter((id) => !hostIds.has(id));
  const { hosts: owners, names: teamNames } = await accountContacts(teamIds);
  const rank = { owner: 0, admin: 1, team: 2 } as const;
  const accounts: TeamAccount[] = [
    ...memberships.map((m) => ({ id: m.organization_id, name: m.organizations?.name ?? "Your account", role: m.role })),
    ...teamIds.map((id) => ({
      id,
      name: teamNames.get(id) ?? "Another account",
      role: "team" as const,
      label: [...new Set(myStaff.filter((st) => st.events!.organization_id === id).map((st) => (st.role === "volunteer_director" ? "Volunteer Lead" : "Coordinator")))].join(" and "),
    })),
  ].sort((x, y) => rank[x.role] - rank[y.role] || x.name.localeCompare(y.name));
  const current = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  if (!current) return { me: userId, accounts, current, host: null, lead: null, myRoles: [] };

  if (current.role !== "team") {
    const timezone = memberships.find((m) => m.organization_id === current.id)?.organizations?.default_timezone || "America/Chicago";
    return { me: userId, accounts, current, host: await loadHostView({ ...current, timezone }, userId, origin), lead: null, myRoles: [] };
  }

  // An account where you're on event teams: Coordinators on the events you lead, and your own roles.
  const here = myStaff.filter((s) => s.events!.organization_id === current.id);
  const ledEvents = here.filter((s) => s.role === "volunteer_director").map((s) => toEvent(s.events!));
  const lead = ledEvents.length ? await loadLeadView(ledEvents, origin, current.id, owners.get(current.id)?.name ?? null, userId) : null;
  // The jobs you lead there, so leaving can name them.
  const { data: myLeads } = here.length
    ? await supabase.from("station_leads").select("event_id, stations(name)").eq("user_id", userId).in("event_id", here.map((s) => s.event_id))
    : { data: [] };
  const myJobs = (myLeads ?? []) as unknown as { event_id: string; stations: { name: string } | null }[];
  // Each event's Volunteer Leads, by name and email (event_volunteer_leads(): only for its team).
  const leadsRes = here.length ? await supabase.rpc("event_volunteer_leads", { p_events: here.map((st) => st.event_id) }) : { data: [], error: null };
  check([leadsRes]);
  const eventLeads = (leadsRes.data ?? []) as { event_id: string; user_id: string; full_name: string; email: string }[];
  const myRoles: MyRole[] = here
    .map((s) => ({
      event: toEvent(s.events!),
      role: s.role,
      jobs: s.role === "section_lead" ? myJobs.filter((j) => j.event_id === s.event_id).map((j) => j.stations?.name ?? "").filter(Boolean) : [],
      soleJobs: [],
      soleLead: false,
      accountHost: owners.get(current.id) ?? null,
      leads: eventLeads.filter((l) => l.event_id === s.event_id && l.user_id !== userId).map((l) => ({ name: l.full_name, email: l.email })),
    }))
    .sort(byStart);
  return { me: userId, accounts, current, host: null, lead, myRoles };
}

/** Each event's jobs, in setup order, and whether someone leads each one. */
async function loadJobs(eventIds: string[]): Promise<EventJobs> {
  if (!eventIds.length) return {};
  const supabase = await createClient();
  const [{ data: stations }, { data: leads }] = await Promise.all([
    supabase.from("stations").select("id, name, event_id").in("event_id", eventIds).order("sort_order").order("created_at"),
    supabase.from("station_leads").select("station_id").in("event_id", eventIds),
  ]);
  const led = new Set((leads ?? []).map((l) => l.station_id));
  const jobs: EventJobs = {};
  for (const st of stations ?? []) (jobs[st.event_id] ??= []).push({ id: st.id, name: st.name, led: led.has(st.id) });
  return jobs;
}

async function loadHostView(org: { id: string; name: string; timezone: string }, userId: string, origin: string): Promise<HostView> {
  const supabase = await createClient();
  const [members, eventsRes, invitesRes, removalsRes, spotsRes, offersRes] = await Promise.all([
    supabase.from("organization_members").select("user_id, role, profiles(full_name, email, phone)").eq("organization_id", org.id).order("created_at"),
    supabase.from("events").select("id, name, starts_on, ends_on, timezone").eq("organization_id", org.id).order("starts_on"),
    supabase
      .from("invitations")
      .select("id, email, role, as_host, event_id, token, created_at, sent_at, expires_at, stations(name)")
      .eq("organization_id", org.id)
      .is("accepted_at", null)
      .order("created_at"),
    supabase
      .from("team_removals")
      .select("id, role, user_id, email, full_name, removed_by, removed_at, event_id")
      .eq("organization_id", org.id)
      .gte("removed_at", removedSince())
      .order("removed_at", { ascending: false }),
    supabase.rpc("team_spots", { p_org: org.id }),
    // Offers of the Account Host role from the last few weeks: the open one, and how the last one ended.
    supabase
      .from("account_host_handoffs")
      .select("to_user, offered_by, created_at, expires_at, accepted_at, cancelled_at, closed_reason")
      .eq("organization_id", org.id)
      .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  // A failed load never shows as an empty team or a team with no limit.
  const failed = [members, eventsRes, invitesRes, removalsRes, spotsRes, offersRes].find((r) => r.error)?.error;
  if (failed) {
    // Before the My team database update has been run: say so.
    if (isSchemaError(failed)) missing();
    throw new Error(`My team couldn't load: ${failed.message}`);
  }
  const [memberData, eventData, inviteData, removalData, spotData] = [members.data, eventsRes.data, invitesRes.data, removalsRes.data, spotsRes.data];
  const events = new Map(((eventData ?? []) as EventRow[]).map((e) => [e.id, toEvent(e)]));
  // Helpers on events that ended over a year ago aren't listed (and aren't loaded): it keeps
  // the page quick for accounts with years of events.
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const ids = [...events.values()].filter((e) => !e.ended || e.ends_on >= yearAgo).map((e) => e.id);
  const [{ data: staffData }, { data: leadData }] = ids.length
    ? await Promise.all([
        supabase.from("event_staff").select("user_id, role, event_id, profiles(full_name, email, phone)").in("event_id", ids).order("created_at"),
        supabase.from("station_leads").select("user_id, event_id, stations(name)").in("event_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  const staff = (staffData ?? []) as unknown as StaffRow[];
  const leads = (leadData ?? []) as unknown as LeadRow[];

  const hosts = ((memberData ?? []) as unknown as { user_id: string; role: "owner" | "admin"; profiles: Profile | null }[])
    .map((m) => ({ userId: m.user_id, role: m.role, profile: m.profiles ?? NO_PROFILE }))
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  const accountHost = hosts.find((h) => h.role === "owner") ?? null;

  const current = groupPeople(staff.filter((s) => !events.get(s.event_id)?.ended), leads, events);
  const onTeam = new Set(current.map((p) => p.userId));
  const past = groupPeople(staff.filter((s) => events.get(s.event_id)?.ended && !onTeam.has(s.user_id)), leads, events);

  const invites = ((inviteData ?? []) as unknown as InviteRow[]).map((i) => toInvite(i, events, origin));
  const coHostInvites = invites.filter((i) => i.asHost);
  const eventInvites = invites.filter((i) => !i.asHost && i.event && !i.event.ended);

  const invited = new Set(invites.map((i) => i.email.toLowerCase()));
  const removed = recentRemovals(
    (removalData ?? []) as RemovalRow[],
    events,
    (r) =>
      invited.has(r.email.toLowerCase()) ||
      (r.role === "co_host" ? hosts.some((h) => h.userId === r.user_id) : staff.some((s) => s.user_id === r.user_id && s.event_id === r.event_id && s.role === r.role)),
    userId,
  );

  const upcoming = [...events.values()].filter((e) => !e.ended);
  const jobs = await loadJobs(upcoming.map((e) => e.id));
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // Upgrade hints name only packages that can still be given (not retired).
  const packages = (await loadTiers()).filter((t) => t.kind === "package" && !t.retired_at);
  type OfferRow = {
    to_user: string;
    offered_by: string | null;
    created_at: string;
    expires_at: string;
    accepted_at: string | null;
    cancelled_at: string | null;
    closed_reason: string | null;
  };
  const offerRows = (offersRes.data ?? []) as OfferRow[];
  const now = new Date().toISOString();
  const localDay = (iso: string) => utcToZonedDate(iso, org.timezone);
  const openOffer = offerRows.find((o) => !o.accepted_at && !o.cancelled_at && o.expires_at > now) ?? null;
  const offeredTo = openOffer ? hosts.find((h) => h.userId === openOffer.to_user) : null;
  // The token of an offer to you comes from the server (my_account_host_offer), never the table.
  const myToken = openOffer?.to_user === userId ? ((await supabase.rpc("my_account_host_offer", { p_org: org.id })).data as string | null) : null;
  // Your last offer, if it ended in the past week (not the ones you withdrew or replaced yourself).
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const last = offerRows.find((o) => o.offered_by === userId && o !== openOffer);
  const lastEnd = last ? (last.accepted_at ?? last.cancelled_at ?? last.expires_at) : null;
  const lastOutcome: OfferOutcome["outcome"] | null = !last
    ? null
    : last.accepted_at
      ? "accepted"
      : last.closed_reason === "declined"
        ? "declined"
        : // Ended because they left, unless they're back (Undo): then it just ended.
          last.closed_reason === "left"
          ? hosts.some((h) => h.userId === last.to_user)
            ? "ended"
            : "left"
        : !last.cancelled_at && last.expires_at <= now
          ? "expired"
          : null;
  const lastName = last ? (hosts.find((h) => h.userId === last.to_user) ? personName(hosts.find((h) => h.userId === last.to_user)!.profile) : "the co-host") : "";
  const s = (spotData ?? {}) as { used?: number; invited?: number; max?: number | null; plan?: string | null; event_staff?: boolean };
  return {
    kind: "host",
    org: { id: org.id, name: org.name },
    offer:
      openOffer && offeredTo
        ? { userId: openOffer.to_user, name: personName(offeredTo.profile), offeredOn: localDay(openOffer.created_at), expiresOn: localDay(new Date(new Date(openOffer.expires_at).getTime() - 1000).toISOString()) }
        : null,
    offerToMe:
      openOffer && myToken && accountHost
        ? { token: myToken, from: personName(accountHost.profile), expiresOn: localDay(new Date(new Date(openOffer.expires_at).getTime() - 1000).toISOString()) }
        : null,
    lastOffer: last && lastOutcome && lastEnd && lastEnd >= weekAgo ? { name: lastName, outcome: lastOutcome, on: localDay(lastEnd) } : null,
    isAccountHost: accountHost?.userId === userId,
    accountHost,
    hosts,
    coHostInvites,
    people: current,
    eventInvites,
    past,
    removed,
    upcoming,
    jobs,
    gaps: upcoming
      .map((event) => {
        const gone = removed.find((r) => r.role === "section_lead" && r.event?.id === event.id && r.removedAt >= monthAgo);
        const open = (jobs[event.id] ?? []).filter((j) => !j.led).map((j) => j.name);
        return gone && open.length ? { event, gone, open } : null;
      })
      .filter((g) => g !== null),
    spots: {
      used: s.used ?? hosts.length,
      invited: s.invited ?? 0,
      max: s.max ?? null,
      plan: s.plan ?? null,
      eventStaff: s.event_staff ?? true,
      bigger: packages.find((t) => s.max != null && (t.max_team === null || t.max_team > s.max))?.name ?? null,
      withStaff: packages.find((t) => t.event_staff)?.name ?? null,
    },
  };
}

async function loadLeadView(ledEvents: TeamEvent[], origin: string, orgId: string, accountHost: string | null, userId: string): Promise<LeadView> {
  const supabase = await createClient();
  const ids = ledEvents.map((e) => e.id);
  const events = new Map(ledEvents.map((e) => [e.id, e]));
  const leadResults = await Promise.all([
    supabase.from("event_staff").select("user_id, role, event_id, profiles(full_name, email, phone)").in("event_id", ids).eq("role", "section_lead").order("created_at"),
    supabase.from("station_leads").select("user_id, event_id, stations(name)").in("event_id", ids),
    supabase
      .from("invitations")
      .select("id, email, role, as_host, event_id, token, created_at, sent_at, expires_at, stations(name)")
      .in("event_id", ids)
      .eq("role", "section_lead")
      .is("accepted_at", null)
      .order("created_at"),
    // Volunteer Leads see removed Coordinators only (the database's rule).
    supabase
      .from("team_removals")
      .select("id, role, user_id, email, full_name, removed_by, removed_at, event_id")
      .in("event_id", ids)
      .gte("removed_at", removedSince())
      .order("removed_at", { ascending: false }),
    supabase.rpc("team_is_full", { p_org: orgId }),
  ]);
  check(leadResults);
  const [{ data: staffData }, { data: leadData }, { data: inviteData }, { data: removalData }, { data: fullData }] = leadResults;
  const staff = (staffData ?? []) as unknown as StaffRow[];
  const leads = (leadData ?? []) as unknown as LeadRow[];
  const invites = ((inviteData ?? []) as unknown as InviteRow[]).map((i) => toInvite(i, events, origin));
  const invited = new Set(invites.map((i) => i.email.toLowerCase()));
  return {
    kind: "lead",
    full: fullData === true,
    accountHost,
    jobs: await loadJobs(ids),
    events: ledEvents
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((event) => ({
        event,
        coordinators: groupPeople(
          staff.filter((s) => s.event_id === event.id),
          leads,
          events,
        ),
        invites: invites.filter((i) => i.event?.id === event.id),
      })),
    removed: recentRemovals(
      (removalData ?? []) as RemovalRow[],
      events,
      (r) => invited.has(r.email.toLowerCase()) || staff.some((s) => s.user_id === r.user_id && s.event_id === r.event_id && s.role === r.role),
      userId,
    ),
  };
}

/**
 * Who to ask about an account, for the people on its event teams (who can't read the account
 * itself): its name, and its Account Host's name and email. The database limits this to accounts
 * where one of your events isn't over (account_contacts()).
 */
async function accountContacts(orgIds: string[]) {
  const hosts = new Map<string, { name: string; email: string }>();
  const names = new Map<string, string>();
  if (!orgIds.length) return { hosts, names };
  const res = await (await createClient()).rpc("account_contacts", { p_orgs: orgIds });
  check([res]);
  const data = res.data;
  for (const row of (data ?? []) as { organization_id: string; organization: string; host_name: string | null; host_email: string | null }[]) {
    names.set(row.organization_id, row.organization);
    if (row.host_email) hosts.set(row.organization_id, { name: row.host_name ?? row.host_email, email: row.host_email });
  }
  return { hosts, names };
}

/** Whether to show My team in the menu: hosts, co-hosts, and anyone on an event's team. */
export async function hasTeamPage(userId: string) {
  const supabase = await createClient();
  const [members, staff] = await Promise.all([
    supabase.from("organization_members").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("event_staff").select("user_id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return (members.count ?? 0) + (staff.count ?? 0) > 0;
}
