import Link from "next/link";
import type { ReactNode } from "react";
import { SetupTabs } from "../../_components/setup-tabs";
import { Badge, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getEventAccess, getOrigin } from "@/lib/data";
import { formatPhone } from "@/lib/phone";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";
import {
  addTeamMember,
  cancelInvitation,
  changeCoHost,
  inviteMember,
  reinviteMember,
  removeAccountCoHost,
  removeEventCoHost,
  removeFromEvents,
  resendInvitation,
  stopCohosting,
} from "../../../team-actions";
import { CopyLinkButton, DeleteButton, RemoveButton, SmallActionButton } from "../forms";
import { AddToTeam, ChoiceWindowButton, type TeamOption } from "./team-windows";
import { leadWords } from "@/lib/event-types";
import { CO_HOST_POWERS } from "@/lib/team-words";

type Person = { full_name: string; email: string; phone: string | null } | null;
type StaffRow = { user_id: string; role: "volunteer_director" | "section_lead" | "co_host"; profiles: Person };
type Host = { user_id: string; full_name: string; email: string; phone: string | null; kind: "owner" | "every" | "event" };
type Invitation = {
  id: string;
  email: string;
  role: "volunteer_director" | "section_lead" | "co_host" | null;
  as_host: boolean;
  station_id: string | null;
  token: string;
  expires_at: string;
  sent_at: string | null;
};
type Removal = {
  id: string;
  role: "co_host" | "volunteer_director" | "section_lead";
  event_id: string | null;
  user_id: string;
  email: string;
  full_name: string;
  removed_by: string | null;
  removed_at: string;
};
type OptionRow = { user_id: string; full_name: string; email: string; kind: string; event_id: string | null; event_name: string | null; event_over: boolean; holds_spot: boolean };
export type TeamTab = "hosts" | "volunteer-leads" | "section-leads";

const first = (name: string) => name.split(/\s+/)[0] || name;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The team, one tab per role (see "Setup pages" in docs/DESIGN.md): co-hosts, Volunteer Leads, and Coordinators
 * in Edit details → Team setup. Co-hosts are of every event, of some events, or of this event only
 * (docs/design-decisions/2026-11-11-event-cohosts.md). Each tab adds people already on the team first, then
 * someone new by email.
 */
export async function TeamRoles({
  eventId,
  roles: asked,
  open: tabParam,
  href,
}: {
  eventId: string;
  /** The roles to show, in order (one tab each). */
  roles: TeamTab[];
  /** The role to open (from a link); otherwise the first. */
  open?: string | null;
  /** Where a role's tab goes. */
  href: (tab: TeamTab) => string;
}) {
  const access = await getEventAccess(eventId);
  // Hosts manage co-hosts (the Account Host adds and removes them) and Volunteer Leads; Volunteer Leads manage Coordinators.
  const roles = asked.filter((r) => (access.isHost ? true : access.canManage && r === "section-leads"));
  if (!roles.length) return null;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: event } = await supabase.from("events").select("id, organization_id, name, event_type, ends_on, timezone").eq("id", eventId).maybeSingle();
  if (!event) missing();
  const lead = leadWords(event.event_type);

  const [{ data: staff }, { data: invitationData }, { data: stationData }, { data: leadRows }, { data: hostData }, { data: removalData }, { data: optionData }] =
    await Promise.all([
      supabase.from("event_staff").select("user_id, role, profiles(full_name, email, phone)").eq("event_id", eventId).order("created_at"),
      // This event's invitations, and the account's co-host invitations.
      supabase
        .from("invitations")
        .select("id, email, role, as_host, station_id, token, expires_at, sent_at")
        .or(`event_id.eq.${eventId},and(as_host.eq.true,organization_id.eq.${event.organization_id})`)
        .is("accepted_at", null)
        .order("created_at"),
      supabase.from("stations").select("id, name").eq("event_id", eventId).order("sort_order").order("created_at"),
      supabase.from("station_leads").select("station_id, user_id").eq("event_id", eventId).order("created_at"),
      // The event's hosts: names and emails for everyone who hosts it (phone numbers only for the account's hosts).
      access.isHost ? supabase.rpc("event_hosts", { p_event: eventId }) : Promise.resolve({ data: [] }),
      supabase
        .from("team_removals")
        .select("id, role, event_id, user_id, email, full_name, removed_by, removed_at")
        .or(`event_id.eq.${eventId},and(role.eq.co_host,organization_id.eq.${event.organization_id})`)
        .order("removed_at", { ascending: false }),
      supabase.rpc("team_options", { p_event: eventId }),
    ]);
  const staffRows = (staff ?? []) as unknown as StaffRow[];
  const hosts = ((hostData ?? []) as Host[]).sort((a, b) => Number(b.kind === "owner") - Number(a.kind === "owner"));
  const accountHost = hosts.find((h) => h.kind === "owner");
  const isAccountHost = accountHost?.user_id === user.id;
  // Co-hosts of every event and the Account Host see the account's team; co-hosts of one event see this event's.
  const wide = hosts.some((h) => h.user_id === user.id && h.kind !== "event");
  const directors = staffRows.filter((s) => s.role === "volunteer_director");
  const leads = staffRows.filter((s) => s.role === "section_lead");
  const invitations = (invitationData ?? []) as Invitation[];
  const stations = (stationData ?? []).map((st) => ({
    ...st,
    lead_ids: (leadRows ?? []).filter((l) => l.station_id === st.id).map((l) => l.user_id),
  }));
  const unled = stations.filter((s) => s.lead_ids.length === 0);
  const origin = await getOrigin();
  const options = (optionData ?? []) as OptionRow[];

  // How far each co-host of one event reaches on the account (the account's hosts can see it).
  const eventCoHosts = hosts.filter((h) => h.kind === "event");
  const everyIds = hosts.filter((h) => h.kind === "every").map((h) => h.user_id);
  const [{ data: reachData }, { data: accountEvents }, spots, { data: otherJobs }] = await Promise.all([
    wide && eventCoHosts.length
      ? supabase
          .from("event_staff")
          .select("user_id, events!inner(id, name, organization_id)")
          .eq("role", "co_host")
          .eq("events.organization_id", event.organization_id)
          .in("user_id", eventCoHosts.map((h) => h.user_id))
      : Promise.resolve({ data: [] }),
    wide ? supabase.from("events").select("id, ends_on, timezone").eq("organization_id", event.organization_id) : Promise.resolve({ data: [] }),
    wide
      ? supabase.rpc("team_spots", { p_org: event.organization_id }).then((r) => (r.data ?? null) as { used: number; max: number | null } | null)
      : supabase.rpc("team_is_full", { p_org: event.organization_id }).then((r) => ({ used: 0, max: r.data ? 0 : null })),
    // Jobs co-hosts of every event lead on other events (Change… to this event only takes them off those).
    isAccountHost && everyIds.length
      ? supabase.from("station_leads").select("user_id, event_id, stations(name), events(name)").in("user_id", everyIds).neq("event_id", eventId)
      : Promise.resolve({ data: [] }),
  ]);
  const jobsElsewhere = (userId: string) =>
    ((otherJobs ?? []) as unknown as { user_id: string; stations: { name: string } | null; events: { name: string } | null }[])
      .filter((j) => j.user_id === userId && j.stations)
      .map((j) => `${j.stations!.name} at ${j.events?.name ?? "another event"}`);
  // A co-host of one event keeps access until 10 days after it ends.
  const accessEnd = (() => {
    const d = new Date(`${event.ends_on}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 10);
    return d.toISOString().slice(0, 10);
  })();
  const eventOver = event.ends_on < utcToZonedDate(new Date().toISOString(), event.timezone || "America/Chicago");
  const reach = new Map<string, string[]>();
  for (const r of (reachData ?? []) as unknown as { user_id: string; events: { name: string } }[]) {
    reach.set(r.user_id, [...(reach.get(r.user_id) ?? []), r.events.name]);
  }
  const allEvents = (accountEvents ?? []).length;
  // Other events a co-host of every event stays on when taken off this one: those not more than 10 days over.
  const openOthers = ((accountEvents ?? []) as { id: string; ends_on: string; timezone: string | null }[]).filter((e) => {
    if (e.id === eventId) return false;
    const today = utcToZonedDate(new Date().toISOString(), e.timezone || "America/Chicago");
    const cutoff = new Date(`${e.ends_on}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 10);
    return cutoff.toISOString().slice(0, 10) >= today;
  }).length;
  const full = spots?.max != null && spots.used >= spots.max;
  const spotsLine =
    spots?.max != null && wide
      ? `It takes 1 of your ${spots.max} team spots as soon as it's sent (${spots.used} in use now). Adding someone already on your team doesn't take another.`
      : undefined;
  const fullMessage = (
    <>
      <span className="font-semibold">All {spots?.max ?? ""} team spots are in use.</span> Add someone from your team above (they don&apos;t
      take another spot), remove someone or cancel an invitation on{" "}
      <Link href="/dashboard/team" className="font-medium text-brand underline-offset-4 hover:underline">
        My team
      </Link>
      , or move to a plan with more spots on the{" "}
      <Link href="/dashboard/account" className="font-medium text-brand underline-offset-4 hover:underline">
        Account page
      </Link>
      .
    </>
  );

  const removals = ((removalData ?? []) as Removal[]).filter((r) => r.role !== "co_host" || r.event_id === null || r.event_id === eventId);
  const stationName = (id: string | null) => stations.find((s) => s.id === id)?.name;
  const jobsLed = (userId: string) => stations.filter((s) => s.lead_ids.includes(userId)).map((s) => s.name);

  // "From your team": one row per person, saying what they do now, without the ones already in the tab's role.
  const optionsFor = (tab: TeamTab): TeamOption[] => {
    const skip = new Set<string>([user.id, ...hosts.filter((h) => h.kind === "owner").map((h) => h.user_id)]);
    if (tab === "hosts") hosts.forEach((h) => skip.add(h.user_id));
    if (tab === "volunteer-leads") [...hosts.map((h) => h.user_id), ...directors.map((d) => d.user_id)].forEach((id) => skip.add(id));
    if (tab === "section-leads") [...hosts.map((h) => h.user_id), ...leads.map((l) => l.user_id)].forEach((id) => skip.add(id));
    const byPerson = new Map<string, { name: string; roles: string[]; holds: boolean }>();
    for (const o of options) {
      if (skip.has(o.user_id)) continue;
      const entry = byPerson.get(o.user_id) ?? { name: o.full_name || o.email, roles: [], holds: o.holds_spot };
      const role =
        o.kind === "admin"
          ? "Co-host of every event"
          : o.kind === "co_host"
            ? `Co-host of ${o.event_name}`
            : o.kind === "volunteer_director"
              ? `Volunteer Lead of ${o.event_name}`
              : o.kind === "section_lead"
                ? `${lead.one} at ${o.event_name}`
                : null;
      if (role) entry.roles.push(o.event_over ? `${role} (event ended)` : role);
      // Co-host includes running volunteers, so it takes the place of their Volunteer Lead role here.
      if (tab === "hosts" && o.kind === "volunteer_director" && o.event_id === eventId) entry.roles.push("Co-host replaces their Volunteer Lead role here");
      byPerson.set(o.user_id, entry);
    }
    return [...byPerson.entries()].map(([userId, p]) => ({ userId, name: p.name, now: p.roles.join(" · "), takesSpot: !p.holds }));
  };

  // Everything one role's step needs.
  const roleInfo = (tab: TeamTab) => {
    const pending = invitations.filter((inv) =>
      tab === "hosts" ? inv.as_host || inv.role === "co_host" : tab === "volunteer-leads" ? inv.role === "volunteer_director" : inv.role === "section_lead",
    );
    const current = new Set((tab === "hosts" ? hosts : tab === "volunteer-leads" ? directors : leads).map((m) => m.user_id));
    const removed = removals.filter(
      (r) =>
        (tab === "hosts" ? r.role === "co_host" : r.role === (tab === "volunteer-leads" ? "volunteer_director" : "section_lead")) &&
        !current.has(r.user_id) &&
        !pending.some((inv) => inv.email.toLowerCase() === r.email.toLowerCase()),
    );
    // The Account Host adds co-hosts; hosts add Volunteer Leads; Volunteer Leads add Coordinators too.
    const canInvite = tab === "hosts" ? isAccountHost : access.isHost || tab === "section-leads";
    const roleName = tab === "hosts" ? "co-host" : tab === "volunteer-leads" ? "Volunteer Lead" : lead.one;
    return { pending, removed, canInvite, roleName };
  };
  const coHosts = hosts.filter((h) => h.kind !== "owner").length;
  const count = { hosts: coHosts, "volunteer-leads": directors.length, "section-leads": leads.length };
  const steps: Record<TeamTab, { title: string; status: string }> = {
    hosts: { title: "Co-hosts", status: plural(coHosts, "co-host", "co-hosts") },
    "volunteer-leads": { title: "Volunteer Leads", status: plural(directors.length, "Volunteer Lead", "Volunteer Leads") },
    // Optional: a sign-up runs fine without one.
    "section-leads": { title: lead.many, status: plural(leads.length, lead.one, lead.many) },
  };
  // A link here can name a role (?tab=section-leads).
  const active: TeamTab = roles.find((r) => r === tabParam) ?? roles[0];
  const myKind = hosts.find((h) => h.user_id === user.id)?.kind;

  // A co-host's row: who they are, how far they reach, and (for the Account Host) Change… and Remove….
  const hostRow = (h: Host) => {
    const name = h.full_name || h.email;
    const others = (reach.get(h.user_id) ?? []).filter((n) => n !== event.name);
    const reachLine =
      h.kind === "owner"
        ? null
        : !wide
          ? null
          : h.kind === "every"
            ? "Co-host of every event"
            : others.length
              ? `Co-host of ${others.length + 1} events: ${[event.name, ...others].join(", ")}`
              : `Co-host of ${event.name} only`;
    const reachShown = reachLine && h.kind === "event" && eventOver ? `${reachLine} · Access ends ${formatDate(accessEnd)}` : reachLine;
    const jobs = jobsLed(h.user_id);
    const jobLine = jobs.length ? `Jobs ${first(name)} leads here (${jobs.join(", ")}) will need a new ${lead.one}` : null;
    const you = h.user_id === user.id;
    let actions: ReactNode = null;
    if (isAccountHost && h.kind === "every") {
      actions = (
        <>
          <ChoiceWindowButton
            label={`Change… ${name}`}
            title={`Change what ${name} co-hosts`}
            choices={[
              {
                value: "only",
                label: `${event.name} only`,
                points: [
                  `${first(name)} loses access to your other ${plural(allEvents - 1, "event", "events")}, and won't be added to new ones`,
                  ...jobsElsewhere(h.user_id).map((j) => `${j} will need a new ${lead.one}`),
                  "No change to team spots",
                ],
                firstMatters: true,
                confirmLabel: `Make ${first(name)} a co-host of ${event.name} only`,
              },
            ]}
            action={changeCoHost.bind(null, event.organization_id, h.user_id, name, "only", eventId)}
            keepLabel="Keep as is"
            notifyLabel={`Let ${first(name)} know by email`}
            pendingText="Changing…"
          >
            Change…
          </ChoiceWindowButton>
          <ChoiceWindowButton
            label={`Remove… ${name}`}
            title={`Remove ${name}?`}
            legend={`Remove ${first(name)} from`}
            choices={[
              {
                value: "event",
                label: `Just from ${event.name}`,
                points: [
                  `${first(name)} stays a co-host of your other ${plural(openOthers, "open event", "open events")}, but won't be added to new events unless you add them to each one`,
                  `${first(name)} loses access to ${event.name} right away`,
                  ...(jobLine ? [jobLine] : []),
                  `${first(name)} keeps their team spot`,
                  `To make ${first(name)} a co-host of every event again, use Change… on My team`,
                ],
                firstMatters: true,
                confirmLabel: "Remove from this event",
              },
              {
                value: "all",
                label: `From every event (takes ${first(name)} off your team)`,
                points: [
                  `${first(name)} loses access to every event right away`,
                  ...(jobLine ? [jobLine.replace("leads here", `leads`)] : []),
                  "A team spot opens up",
                  "You can invite them again from Removed or left recently on My team",
                ],
                confirmLabel: `Remove ${first(name)} from the team`,
              },
            ]}
            action={removeEventCoHost.bind(null, eventId, h.user_id, name, true)}
            keepLabel={`Keep ${first(name)}`}
            notifyLabel={`Let ${first(name)} know by email`}
            pendingText="Removing…"
          >
            Remove…
          </ChoiceWindowButton>
        </>
      );
    } else if (isAccountHost && h.kind === "event") {
      actions = (
        <>
          <ChoiceWindowButton
            label={`Change… ${name}`}
            title={`Change what ${name} co-hosts`}
            choices={[
              {
                value: "every",
                label: "Every event",
                points: [
                  `${first(name)} sees and runs every event on the account right away, and any you add later`,
                  "No change to team spots",
                ],
                confirmLabel: `Make ${first(name)} a co-host of every event`,
              },
            ]}
            action={changeCoHost.bind(null, event.organization_id, h.user_id, name, "every", null)}
            keepLabel="Keep as is"
            notifyLabel={`Let ${first(name)} know by email`}
            pendingText="Changing…"
            danger={false}
          >
            Change…
          </ChoiceWindowButton>
          <ChoiceWindowButton
            label={`Remove… ${name}`}
            title={`Remove ${name}?`}
            choices={[
              {
                value: "event",
                label: event.name,
                points: [
                  `${first(name)} loses access to ${event.name} right away`,
                  ...(jobLine ? [jobLine] : []),
                  ...(others.length ? [`${first(name)} stays a co-host of ${others.join(", ")}`] : []),
                  ...(spots?.max != null ? [others.length ? `${first(name)} keeps their team spot` : "A team spot opens up"] : []),
                  "You can invite them again from Removed or left recently on My team",
                ],
                confirmLabel: "Remove from this event",
              },
            ]}
            action={removeEventCoHost.bind(null, eventId, h.user_id, name, false)}
            keepLabel={`Keep ${first(name)}`}
            notifyLabel={`Let ${first(name)} know by email`}
            pendingText="Removing…"
          >
            Remove…
          </ChoiceWindowButton>
        </>
      );
    } else if (you && h.kind === "event") {
      actions = (
        <ChoiceWindowButton
          title={`Stop co-hosting ${event.name}?`}
          choices={[
            {
              value: "leave",
              label: event.name,
              points: [
                `You lose access to ${event.name} right away`,
                `We'll tell ${accountHost?.full_name || "the Account Host"}, your Account Host`,
                `To come back, ask ${first(accountHost?.full_name || "the Account Host")} to add you again`,
              ],
              confirmLabel: "Stop co-hosting",
            },
          ]}
          action={stopCohosting.bind(null, eventId)}
          keepLabel="Keep co-hosting"
          pendingText="Leaving…"
        >
          Stop co-hosting…
        </ChoiceWindowButton>
      );
    } else if (you && h.kind === "every") {
      actions = (
        <RemoveButton
          action={removeAccountCoHost.bind(null, event.organization_id, h.user_id, name)}
          label="Stop being a co-host"
          confirmMessage="Stop being a co-host? You'll lose access to all of this organization's events."
        />
      );
    }
    return (
      <PersonRow
        key={h.user_id}
        name={name}
        isYou={you}
        badge={h.kind === "owner" ? "Account Host" : "Co-host"}
        reach={reachShown}
        details={[h.email, formatPhone(h.phone)]}
      >
        {actions}
      </PersonRow>
    );
  };

  const groups = wide
    ? [
        { title: "Every event", people: hosts.filter((h) => h.kind !== "event") },
        { title: "Some events", people: eventCoHosts.filter((h) => (reach.get(h.user_id) ?? []).length > 1) },
        { title: "This event only", people: eventCoHosts.filter((h) => (reach.get(h.user_id) ?? []).length <= 1) },
      ]
    : [{ title: "", people: hosts }];

  return (
    <div className="flex flex-col gap-4">
      {roles.length > 1 && (
        <SetupTabs
          label="Team roles"
          way="invite"
          tabs={roles.map((r) => ({
            key: r,
            label: steps[r].title,
            status: count[r] ? steps[r].status : "Optional",
            mark: count[r] ? "done" : undefined,
            href: href(r),
            active: r === active,
          }))}
        />
      )}
      {[active].map((tab) => {
        const { pending, removed, canInvite, roleName } = roleInfo(tab);
        return (
          <Card key={tab} id={tab}>
            <div className="space-y-6">
              {tab === "hosts" && (
                <div>
                  <h2 className="text-sm font-semibold">Current members</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {myKind === "event" ? (
                      <>
                        You co-host {event.name} until {formatDate(accessEnd)}: you can do everything on it except invite or remove co-hosts,
                        or delete it. To add a co-host, ask {accountHost?.full_name || "your Account Host"}, your Account Host.
                      </>
                    ) : (
                      <>
                        {CO_HOST_POWERS}
                        {!isAccountHost && accountHost && <> Your Account Host is {accountHost.full_name || accountHost.email}.</>}{" "}
                        <Link href="/dashboard/team" className="font-medium text-brand underline-offset-4 hover:underline">
                          See everyone on My team
                        </Link>
                      </>
                    )}
                  </p>
                  {groups
                    .filter((g) => g.people.length)
                    .map((g) => (
                      <div key={g.title || "all"}>
                        {g.title && <h3 className="mt-4 text-sm font-semibold">{g.title}</h3>}
                        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">{g.people.map(hostRow)}</ul>
                      </div>
                    ))}
                </div>
              )}

              {tab === "volunteer-leads" && (
                <div>
                  <h2 className="text-sm font-semibold">Current members</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Volunteer Leads run volunteers with you: sign-ups, shifts, volunteers, and check-in. They can add {lead.many}.
                  </p>
                  {directors.length > 0 ? (
                    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                      {directors.map((d) => (
                        <PersonRow
                          key={d.user_id}
                          name={d.profiles?.full_name || d.profiles?.email || "Team member"}
                          isYou={d.user_id === user.id}
                          badge="Volunteer Lead"
                          details={[d.profiles?.email, formatPhone(d.profiles?.phone)]}
                        >
                          {access.isHost && d.user_id !== user.id && (
                            <ChoiceWindowButton
                              label={`Remove… ${d.profiles?.full_name || d.profiles?.email}`}
                              title={`Remove ${d.profiles?.full_name || d.profiles?.email} as Volunteer Lead?`}
                              choices={[
                                {
                                  value: `${eventId}:volunteer_director`,
                                  label: event.name,
                                  points: [
                                    `${first(d.profiles?.full_name || "They")} loses access to ${event.name} right away`,
                                    ...(directors.length === 1 ? [`${event.name} will have no Volunteer Lead, so you and your co-hosts run its volunteers`] : []),
                                    "You can invite them again from Removed or left recently on My team",
                                  ],
                                  confirmLabel: "Remove from this event",
                                },
                              ]}
                              action={removeFromEvents.bind(null, d.user_id, d.profiles?.full_name || d.profiles?.email || "them")}
                              keepLabel={`Keep ${first(d.profiles?.full_name || "them")}`}
                              notifyLabel={`Let ${first(d.profiles?.full_name || "them")} know by email`}
                              pendingText="Removing…"
                            >
                              Remove…
                            </ChoiceWindowButton>
                          )}
                        </PersonRow>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-muted">
                      None yet. You&apos;re running volunteers yourself as the host. Add one or more Volunteer Leads below to share the work.
                    </p>
                  )}
                </div>
              )}

              {tab === "section-leads" && (
                <div>
                  <h2 className="text-sm font-semibold">Current members</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {lead.many} run one sign-up on the day, like {event.event_type === "fair" ? "Face Painting" : "Parking"}. They see who&apos;s on
                    their shifts; phone numbers unlock on event day.
                  </p>
                  {leads.length > 0 ? (
                    <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                      {leads.map((l) => {
                        const led = jobsLed(l.user_id);
                        return (
                          <PersonRow
                            key={l.user_id}
                            name={l.profiles?.full_name || l.profiles?.email || "Team member"}
                            isYou={l.user_id === user.id}
                            badge={lead.one}
                            reach={led.length ? `Leads ${led.join(", ")}` : "No sign-up yet"}
                            details={[l.profiles?.email, formatPhone(l.profiles?.phone)]}
                          >
                            {l.user_id !== user.id && (
                              <ChoiceWindowButton
                                label={`Remove… ${l.profiles?.full_name || l.profiles?.email}`}
                                title={`Remove ${l.profiles?.full_name || l.profiles?.email} as ${lead.one}?`}
                                choices={[
                                  {
                                    value: `${eventId}:section_lead`,
                                    label: event.name,
                                    points: [
                                      `${first(l.profiles?.full_name || "They")} loses access to ${event.name} right away`,
                                      ...led.map((job) => `${job} will need a new ${lead.one}`),
                                      "You can invite them again from Removed or left recently on My team",
                                    ],
                                    confirmLabel: "Remove from this event",
                                  },
                                ]}
                                action={removeFromEvents.bind(null, l.user_id, l.profiles?.full_name || l.profiles?.email || "them")}
                                keepLabel={`Keep ${first(l.profiles?.full_name || "them")}`}
                                notifyLabel={`Let ${first(l.profiles?.full_name || "them")} know by email`}
                                pendingText="Removing…"
                              >
                                Remove…
                              </ChoiceWindowButton>
                            )}
                          </PersonRow>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-muted">None yet.</p>
                  )}
                  {unled.length > 0 && (
                    <p className="mt-3 rounded-lg bg-brand-soft px-3 py-2 text-sm leading-6">
                      <span className="font-medium">No {lead.one} yet (optional):</span>{" "}
                      {unled.map((s, i) => (
                        <span key={s.id}>
                          {i > 0 && ", "}
                          <Link href={`/dashboard/events/${eventId}/volunteering?station=${s.id}`} className="text-brand underline-offset-4 hover:underline">
                            {s.name}
                          </Link>
                        </span>
                      ))}
                      . To add one, add someone below or pick from your team on the sign-up.
                    </p>
                  )}
                </div>
              )}

              {(canInvite || pending.length > 0) && (
              <section>
                <h2 className="text-sm font-semibold">Pending</h2>
                {pending.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">No invitations waiting.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-dashed border-field-border">
                    {pending.map((inv) => {
                      const expired = new Date(inv.expires_at) < new Date();
                      const mine = inv.as_host || inv.role === "co_host" ? isAccountHost : access.isHost || inv.role === "section_lead";
                      return (
                        <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium [overflow-wrap:anywhere]">{inv.email}</p>
                            <p className="text-sm text-muted">
                              {[
                                inv.as_host ? "Co-host of every event" : inv.role === "co_host" ? `Co-host of ${event.name} only` : stationName(inv.station_id),
                                expired ? "Expired" : inv.sent_at ? `Sent ${formatDate(inv.sent_at.slice(0, 10))}` : "Not emailed yet",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {mine && (
                              <SmallActionButton action={resendInvitation.bind(null, eventId, inv.id)} label={`Resend invitation to ${inv.email}`}>
                                {inv.sent_at ? "Resend" : "Send"}
                              </SmallActionButton>
                            )}
                            <CopyLinkButton url={`${origin}/invite/${inv.token}`} label="Copy link" />
                            {mine && (
                              <DeleteButton
                                action={cancelInvitation.bind(null, eventId, inv.id)}
                                label={`Cancel invitation for ${inv.email}`}
                                confirmMessage={`Cancel the invitation for ${inv.email}?`}
                                text="Cancel invitation"
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              )}

              {canInvite && (
                <AddToTeam
                  roleName={roleName}
                  note={tab === "hosts" ? "Co-hosts run the whole event. If they only need to run volunteers, add a Volunteer Lead instead." : undefined}
                  scope={tab === "hosts" ? { eventName: event.name, events: allEvents } : undefined}
                  options={optionsFor(tab)}
                  addAction={addTeamMember.bind(null, eventId)}
                  inviteAction={inviteMember.bind(null, eventId)}
                  inviteRole={tab === "volunteer-leads" ? "volunteer_director" : tab === "section-leads" ? "section_lead" : undefined}
                  stations={tab === "section-leads" ? stations.map((s) => ({ id: s.id, name: s.name })) : undefined}
                  spotsLine={spotsLine}
                  emptyText={wide ? undefined : "Nobody else on this event's team yet. Invite someone new below."}
                  full={full}
                  fullMessage={fullMessage}
                />
              )}

              {removed.length > 0 && (
                <section>
                  <h2 className="text-sm font-semibold">Removed</h2>
                  <ul className="mt-2 space-y-2">
                    {removed.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-muted [overflow-wrap:anywhere]">{r.full_name || r.email}</p>
                          <p className="text-sm text-muted">
                            {[r.full_name ? r.email : null, `${r.removed_by === r.user_id ? "Left" : "Removed"} ${formatDate(r.removed_at.slice(0, 10))}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {canInvite && (
                          <SmallActionButton action={reinviteMember.bind(null, eventId, r.id)} label={`Re-invite ${r.email}`}>
                            Re-invite
                          </SmallActionButton>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** A person on the team: name and role badge, what they do here, then each detail whole (never split mid-number). */
function PersonRow({
  name,
  isYou,
  badge,
  reach,
  details,
  children,
}: {
  name: string;
  isYou: boolean;
  badge: string;
  reach?: string | null;
  details: (string | null | undefined)[];
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <span className="[overflow-wrap:anywhere]">{name}</span>
          {isYou && <span className="font-normal text-muted">(you)</span>}
          <Badge tone="info">{badge}</Badge>
        </p>
        {reach && <p className="mt-0.5 text-sm font-medium">{reach}</p>}
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
          {details.filter(Boolean).map((d) => (
            <span key={d} className="[overflow-wrap:anywhere] sm:whitespace-nowrap">
              {d}
            </span>
          ))}
        </p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </li>
  );
}
