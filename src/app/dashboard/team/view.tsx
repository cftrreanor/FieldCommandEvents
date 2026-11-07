import Link from "next/link";
import type { ReactNode } from "react";
import { LineIcon } from "@/components/line-icon";
import { Badge, Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { formatPhone } from "@/lib/phone";
import { CO_HOST_POWERS, ONE_EVENT_HINT, REMOVAL_NOTE } from "@/lib/team-words";
import { formatDate } from "@/lib/time";
import {
  cancelTeamInvitation,
  inviteAgain,
  inviteCoHost,
  leaveEvent,
  removeAccountCoHost,
  removeFromEvents,
  resendTeamInvitation,
  acceptAccountHost,
  declineAccountHost,
  offerAccountHost,
  resendAccountHostOffer,
  undoRemoval,
  withdrawAccountHostOffer,
} from "../team-actions";
import { personName, UNDO_MINUTES, type HostView, type Invite, type LeadView, type MyRole, type MyTeam, type TeamAccount, type Person, type Removal, type RoleOn, type StaffRole, type TeamEvent } from "./load";
import { ConfirmButton, CopyInviteLink, InviteAgainButton, InviteCoHostButton, RemovePersonButton, RowButton, UndoNote, type RemoveChoice } from "./team-ui";

/** Events offered in Invite again, with their dates. */
const againEvents = (events: TeamEvent[]) => events.map((e) => ({ id: e.id, label: `${e.name} · ${short(e.starts_on)}` }));
/** The team-spot line in Invite again windows. */
const spotLine = (spots: { max: number | null; used: number } | null) =>
  !spots
    ? "It takes one of the account's team spots as soon as it's sent"
    : spots.max === null
      ? "Your plan has no limit on team spots"
      : `It takes 1 of your ${spots.max} team spots as soon as it's sent (${spots.used} in use now)`;

const ROLE: Record<StaffRole | "co_host", string> = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator", co_host: "Co-host" };
/** "Sat, Nov 14", kept on one line. */
const short = (date: string) => formatDate(date.slice(0, 10), { year: undefined }).replace(/ /g, "\u00a0");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const first = (name: string) => name.split(/[\s@]/)[0] || name;
const LINK = "font-medium text-brand underline underline-offset-4";
/** The next step for a plan limit: the plan that has it, where to see your plan, and our address as text. */
const PLAN_LINK = (
  <Link href="/dashboard/account#plan" className={LINK}>
    See your plan on the Account page
  </Link>
);
const writeUs = (
  <>
    write to us at <span className="font-medium text-foreground [overflow-wrap:anywhere]">{brand.supportEmail}</span>
  </>
);

/** My team, for whoever's looking: hosts and co-hosts, Volunteer Leads, and their own roles. */
export function MyTeamView({ team, becameHost = false }: { team: MyTeam; becameHost?: boolean }) {
  const body = (
    <div className="min-w-0 space-y-10">
      {team.host ? (
        <HostSections view={team.host} me={team.me} becameHost={becameHost} />
      ) : team.lead ? (
        <LeadSections view={team.lead} />
      ) : (
        <header>
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">My team</h1>
          <p className="mt-2 text-muted">
            {team.myRoles.length
              ? "The events you help run. You can leave an event here."
              : "You're not on an event's team right now. When someone invites you to help run an event, it shows here."}
          </p>
        </header>
      )}
      {team.myRoles.length > 0 && <MyRoles roles={team.myRoles} other={!!team.host} />}
    </div>
  );
  if (team.accounts.length < 2) return body;
  // On more than one account: pick which one's team to see, from a menu on the left (above, on phones).
  return (
    <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10">
      <AccountMenu accounts={team.accounts} current={team.current} />
      {body}
    </div>
  );
}

const ACCOUNT_ROLE = { owner: "Account Host", admin: "Co-host", team: "Event team" } as const;

function AccountMenu({ accounts, current }: { accounts: TeamAccount[]; current: TeamAccount | null }) {
  const role = (a: TeamAccount) => (a.role === "team" ? (a.label ?? "Event team") : ACCOUNT_ROLE[a.role]);
  const list = (
    <ul className="flex flex-col gap-1">
      {accounts.map((a) => {
        const here = a.id === current?.id;
        return (
          <li key={a.id}>
            <Link
              href={`/dashboard/team?account=${a.id}`}
              aria-current={here ? "page" : undefined}
              className={`flex min-h-11 flex-col justify-center rounded-md border px-3 py-2 text-sm ${
                here ? "border-brand/40 bg-brand-soft font-semibold" : "border-transparent hover:border-border hover:bg-surface"
              }`}
            >
              <span className="[overflow-wrap:anywhere]">{a.name}</span>
              <span className="text-xs font-normal text-muted">{role(a)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      {/* Phones: one line above the page, opened to switch. */}
      <details className="group rounded-lg border border-border bg-surface md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Account: <span className="font-semibold">{current?.name}</span>
          </span>
          <span className="font-medium text-brand">
            <span className="group-open:hidden">Switch</span>
            <span className="hidden group-open:inline">Close</span>
          </span>
        </summary>
        <nav aria-label="Your accounts" className="border-t border-border p-2">
          {list}
        </nav>
      </details>
      {/* Wider screens: a menu on the left. A label, not a heading, so the page's title comes first. */}
      <nav aria-label="Your accounts" className="hidden md:sticky md:top-6 md:block md:self-start">
        <p className="mb-2 text-sm font-semibold text-muted">Your accounts</p>
        {list}
      </nav>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Hosts and co-hosts
// ---------------------------------------------------------------------------------------------

function HostSections({ view, me, becameHost }: { view: HostView; me: string; becameHost: boolean }) {
  const { org, spots, isAccountHost } = view;
  const full = spots.max !== null && spots.used >= spots.max;
  const invitations = spots.invited ? ` and ${plural(spots.invited, "open invitation", "open invitations")}` : "";
  const fullWords = `Your ${spots.plan ?? ""} plan includes ${spots.max} team spots, and an invitation takes one as soon as it's sent. Remove someone or cancel an invitation to free a spot`;
  const justYou = view.hosts.length === 1 && !view.coHostInvites.length && !view.people.length && !view.eventInvites.length;
  const canAddStaff = spots.eventStaff && !full;
  const accountHostName = view.accountHost ? personName(view.accountHost.profile) : "the Account Host";

  return (
    <>
      <header>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">My team</h1>
        <p className="mt-2 text-muted">
          Everyone who helps run {org.name}&apos;s events.{" "}
          {spots.max !== null ? (
            <>
              <strong className="font-semibold text-foreground">
                {spots.used} of {spots.max}
              </strong>{" "}
              team spots used on the {spots.plan} plan, counting you{invitations}.
            </>
          ) : (
            <>
              {plural(spots.used, "team spot", "team spots")} in use, counting you{invitations}. Your {spots.plan} plan has no limit on team spots.
            </>
          )}
        </p>
        {full && (
          <p role="status" className="mt-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm leading-6">
            <strong className="font-semibold">Your team is full.</strong> {fullWords}
            {spots.bigger ? (
              <>
                , or move to {spots.bigger} for more spots. {PLAN_LINK}, or {writeUs} to change plans.
              </>
            ) : (
              <>, or {writeUs} about a bigger team.</>
            )}
          </p>
        )}
      </header>

      {becameHost && isAccountHost && (
        <p role="status" className="rounded-lg border border-success/40 bg-success-soft px-4 py-3 text-sm leading-6">
          <strong className="font-semibold">You&apos;re the Account Host for {org.name} now.</strong> You invite and remove co-hosts, and get and renew the
          plan.
        </p>
      )}
      {view.offerToMe && <OfferToMe offer={view.offerToMe} orgName={org.name} />}
      {view.lastOffer && !view.offer && !becameHost && (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm leading-6 ${view.lastOffer.outcome === "accepted" ? "border-success/40 bg-success-soft" : "border-brand/40 bg-brand-soft"}`}>
          {offerOutcome(view.lastOffer, isAccountHost)}
        </p>
      )}
      <JustRemoved removed={view.removed} />

      <section aria-labelledby="hosts-heading" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="hosts-heading" className="text-xl font-semibold">
            Hosts
          </h2>
          {isAccountHost && (
            <InviteCoHostButton
              action={inviteCoHost.bind(null, org.id)}
              powers={CO_HOST_POWERS}
              hint={ONE_EVENT_HINT}
              // A full team can still make someone already on it a co-host (it takes no new spot).
              blockedBy={full && !view.people.length && !view.eventInvites.length ? "Your team is full" : null}
              candidates={
                full
                  ? [
                      ...view.people.map((p) => ({
                        email: p.profile.email,
                        name: personName(p.profile),
                        role: [...new Set(p.roles.map((r) => ROLE[r.role]))].join(" and "),
                      })),
                      ...view.eventInvites.filter((inv) => !inv.expired).map((inv) => ({ email: inv.email, name: inv.email, role: `Invited as ${ROLE[inv.role ?? "section_lead"]}` })),
                    ].filter((c, i, all) => c.email && all.findIndex((o) => o.email.toLowerCase() === c.email.toLowerCase()) === i)
                  : null
              }
              spotNote={
                spots.max !== null
                  ? full
                    ? "We'll email them a link that works for 30 days. Someone already on your team doesn't take another spot."
                    : `We'll email them a link that works for 30 days. The invitation takes 1 of your ${spots.max} team spots as soon as it's sent (${spots.used} in use now).`
                  : "We'll email them a link that works for 30 days."
              }
            />
          )}
        </div>
        <p className="text-sm leading-6 text-muted">
          {CO_HOST_POWERS}
          {!isAccountHost && <> Your Account Host is {accountHostName}.</>}
        </p>
        {isAccountHost && !view.offer && !justYou && (
          // Passing the account on usually goes to someone new (the next PTO president): say how, quietly.
          <p className="text-sm leading-6 text-muted">
            <strong className="font-semibold text-foreground">Passing the account to someone new?</strong> {PASS_ON(view.hosts.some((h) => h.role === "admin"))}
          </p>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {view.hosts.map((h) => {
            const name = personName(h.profile);
            const you = h.userId === me;
            return (
              <Row
                key={h.userId}
                title={
                  <>
                    {name}
                    {you && " (you)"} <Badge tone="info">{h.role === "owner" ? "Account Host" : "Co-host"}</Badge>
                    {view.offer?.userId === h.userId && !you && (
                      <>
                        {" "}
                        <Badge tone="neutral">Offer waiting</Badge>
                      </>
                    )}
                  </>
                }
                detail={[
                  h.profile.email,
                  formatPhone(h.profile.phone),
                  h.role === "admin" ? "Every event" : null,
                  view.offer?.userId === h.userId && !you && !isAccountHost ? `Offered the Account Host role ${short(view.offer.offeredOn)}, open through ${short(view.offer.expiresOn)}` : null,
                ]}
                // The offer's own buttons sit under its line, apart from Remove… (which stays put on every row).
                after={
                  view.offer?.userId === h.userId && isAccountHost ? (
                    // The offer as its own block (its line and its buttons), so it reads apart from Remove… at every width.
                    <div className="mt-3 space-y-2 rounded-md border-l-2 border-brand/40 bg-brand-soft px-3 py-2">
                      <p className="text-sm leading-6">
                        Offered the Account Host role {short(view.offer.offeredOn)}, open through {short(view.offer.expiresOn)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                      <RowButton action={resendAccountHostOffer.bind(null, org.id, name)} pendingText="Sending…" label={`Resend email: ${name}`}>
                        Resend email
                      </RowButton>
                      <ConfirmButton
                        action={withdrawAccountHostOffer.bind(null, org.id, h.userId, name)}
                        label={`Withdraw offer… ${name}`}
                        title={`Withdraw your offer to ${name}?`}
                        points={[
                          `${first(name)}'s link stops working, and we'll email them that you withdrew it`,
                          "You stay the Account Host. You can offer the role again any time",
                        ]}
                        keepLabel="Keep the offer"
                        confirmLabel="Withdraw offer"
                        pendingText="Withdrawing…"
                        danger={false}
                      >
                        Withdraw offer…
                      </ConfirmButton>
                      </div>
                    </div>
                  ) : null
                }
                actions={
                  h.role === "admin" && you ? (
                    <ConfirmButton
                      action={removeAccountCoHost.bind(null, org.id, h.userId, name)}
                      title="Stop being a co-host?"
                      points={[
                        `You lose access to every ${org.name} event right away`,
                        ...(spots.max !== null ? ["A team spot opens up"] : []),
                        ...(view.offerToMe ? ["This also ends the Account Host offer"] : []),
                        `To come back, ask ${accountHostName} to invite you again`,
                      ]}
                      keepLabel="Stay a co-host"
                      confirmLabel="Stop being a co-host"
                      pendingText="Leaving…"
                    >
                      Stop being a co-host
                    </ConfirmButton>
                  ) : h.role === "admin" && isAccountHost ? (
                    <>
                    {view.offer?.userId === h.userId ? null : (
                      <ConfirmButton
                        action={offerAccountHost.bind(null, org.id, h.userId, name)}
                        label={`Offer Account Host role… ${name}`}
                        title={`Offer ${name} the Account Host role?`}
                        points={[
                          `${first(name)} would become the Account Host: they invite and remove co-hosts, get and renew the plan, and can hand the role on later`,
                          `The plan stays as it is until it ends. After that, renewing it is up to ${first(name)}`,
                          "You'd become a co-host, with the same access to every event as now",
                          `Once ${first(name)} accepts, you can't take it back. Only they could offer it to you again, and as Account Host they could remove you as a co-host`,
                          `We'll email ${first(name)} a link. Nothing changes until they accept, within 14 days`,
                          ...(view.offer ? [`This withdraws your open offer to ${view.offer.name}, and we'll let them know`] : []),
                        ]}
                        keepLabel="Not now"
                        confirmLabel="Send offer"
                        pendingText="Sending…"
                        danger={false}
                      >
                        Offer Account Host role…
                      </ConfirmButton>
                    )}
                    <ConfirmButton
                      action={removeAccountCoHost.bind(null, org.id, h.userId, name)}
                      label={`Remove… ${name}`}
                      title={`Remove ${name} as co-host?`}
                      points={[
                        `${first(name)} loses co-host access to every event right away`,
                        "Jobs they lead on events they aren't on the team for will need a new Coordinator",
                        ...(spots.max !== null ? ["A team spot opens up"] : []),
                        "You can invite them again from Removed or left recently",
                        ...(view.offer?.userId === h.userId ? ["This also ends the Account Host offer"] : []),
                      ]}
                      notifyLabel={`Let ${first(name)} know by email`}
                      keepLabel={`Keep ${first(name)}`}
                      confirmLabel="Remove co-host"
                      pendingText="Removing…"
                    >
                      Remove…
                    </ConfirmButton>
                    </>
                  ) : null
                }
              />
            );
          })}
          {view.coHostInvites.map((inv) => (
            <InviteRow key={inv.id} invite={inv} manage={isAccountHost} what="Co-host" full={full} limited={spots.max !== null} />
          ))}
        </ul>
      </section>

      {justYou ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">It&apos;s just you so far</h2>
          <p className="text-sm leading-6">
            A co-host shares the whole load: every event, start to finish. For one event, add a Volunteer Lead to run volunteers, or Coordinators to
            lead single jobs like parking or the gate.
          </p>
          {isAccountHost && !view.offer && (
            <p className="text-sm leading-6">
              <strong className="font-semibold">Passing the account to someone new?</strong> {PASS_ON(false)}
            </p>
          )}
          <AddStaffLinks view={view} canAdd={canAddStaff} />
        </Card>
      ) : (
        <section aria-labelledby="event-teams-heading" className="space-y-3">
          <h2 id="event-teams-heading" className="text-xl font-semibold">
            Event teams
          </h2>
          {spots.eventStaff && (
            <p className="text-sm leading-6 text-muted">
              Volunteer Leads run volunteers for one event. Coordinators lead one job on the day, like parking or the gate.
              {spots.max !== null && " Each holds a team spot until their event is over."}
            </p>
          )}
          {view.people.length || view.eventInvites.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {view.people.map((p) => (
                <PersonRow key={p.userId} person={p} limited={spots.max !== null} />
              ))}
              {view.eventInvites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} manage what={ROLE[inv.role ?? "section_lead"]} full={full} limited={spots.max !== null} />
              ))}
            </ul>
          ) : (
            spots.eventStaff && (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">No Volunteer Leads or Coordinators on upcoming events.</p>
            )
          )}
          <NeedsCoordinator view={view} full={full} />
          <AddStaffLinks view={view} canAdd={canAddStaff} />
        </section>
      )}

      {view.past.length > 0 && (
        <section aria-labelledby="past-heading" className="space-y-3">
          <h2 id="past-heading" className="text-xl font-semibold">
            Past events
          </h2>
          <p className="text-sm leading-6 text-muted">Their events are over, so they don&apos;t hold a team spot. 10 days after an event, they can&apos;t see it or its team anymore.</p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {view.past.map((p) => {
              const last = p.roles[p.roles.length - 1];
              return (
                <Row
                  key={p.userId}
                  title={personName(p.profile)}
                  detail={[p.profile.email]}
                  actions={
                    canAddStaff ? (
                      <InviteAgainButton
                        name={personName(p.profile)}
                        email={p.profile.email}
                        lastTime={[ROLE[last.role], last.event.name, last.jobs.length ? `led ${last.jobs.join(", ")}` : null].filter(Boolean).join(" · ")}
                        events={againEvents(view.upcoming)}
                        jobs={view.jobs}
                        lastRole={last.role}
                        lastJob={last.jobs[0] ?? null}
                        spotNote={spotLine(spots)}
                        action={inviteAgain.bind(null, org.id, p.profile.email, last.role)}
                      />
                    ) : (
                      <p className="text-sm text-muted">{spots.eventStaff ? "Free a team spot to invite again" : "Not on your plan"}</p>
                    )
                  }
                >
                  <RoleLines roles={p.roles} />
                </Row>
              );
            })}
          </ul>
        </section>
      )}

      <RemovedRecently
        removed={view.removed}
        orgId={org.id}
        events={view.upcoming}
        jobs={view.jobs}
        spotNote={spotLine(spots)}
        blocked={(r) =>
          r.role === "co_host" && !isAccountHost
            ? "Only the Account Host invites co-hosts"
            : r.role !== "co_host" && !spots.eventStaff
              ? "Not on your plan"
              : full
                ? "Free a team spot to invite again"
                : null
        }
      />

      <PrivacyNote>
        Who sees these details: the Account Host and co-hosts see everyone&apos;s email and phone number. Volunteer Leads see their own
        event&apos;s team. People on an event&apos;s team see the names and emails of the Account Host and that event&apos;s Volunteer Lead, so they can ask questions. {REMOVAL_NOTE}
      </PrivacyNote>
    </>
  );
}

/** Who sees the people's details on this page, and what removing does. */
function PrivacyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm leading-6 text-muted">
      <LineIcon name="lock" className="mt-1 size-4" />
      <span>{children}</span>
    </p>
  );
}

/**
 * After a Coordinator leaves or is removed (in the last 30 days), the jobs on that event with
 * nobody leading them, so a gap doesn't go unnoticed. Calm, not a warning: jobs can run without one.
 */
function NeedsCoordinator({ view, full }: { view: HostView; full: boolean }) {
  if (!view.gaps.length) return null;
  return (
    <ul className="space-y-2">
      {view.gaps.map(({ event, gone, open }) => (
        <li key={event.id} className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6">
          <strong className="font-semibold">{open.join(", ")}</strong> at {event.name} {open.length === 1 ? "has" : "have"} no Coordinator. {gone.name}{" "}
          {gone.left ? "left" : "was removed"} {short(gone.removedAt)}.{" "}
          {full ? (
            <span className="text-muted">Free a team spot to invite one.</span>
          ) : (
            <Link href={`/dashboard/events/${event.id}/edit?section=team`} className={LINK}>
              Invite a Coordinator
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Where Volunteer Leads and Coordinators are added: each event's team setup. */
function AddStaffLinks({ view, canAdd }: { view: HostView; canAdd: boolean }) {
  if (!view.spots.eventStaff) {
    return (
      <p className="text-sm leading-6">
        Your {view.spots.plan} plan doesn&apos;t include Volunteer Leads, who run volunteers for one event, or Coordinators, who lead one job on
        the day.{" "}
        {view.spots.withStaff ? (
          <>
            {view.spots.withStaff} includes them. {PLAN_LINK}, or {writeUs} to change plans.
          </>
        ) : (
          <>To add them, {writeUs}.</>
        )}
      </p>
    );
  }
  if (!canAdd) return <p className="text-sm leading-6 text-muted">Free a team spot to add a Volunteer Lead or Coordinator.</p>;
  if (!view.upcoming.length) {
    return (
      <p className="text-sm leading-6">
        Volunteer Leads and Coordinators join one event.{" "}
        <Link href="/dashboard/events/new" className={LINK}>
          Create an event
        </Link>{" "}
        to add them.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">To add a Volunteer Lead or Coordinator, open the event&apos;s team setup</p>
      <ul className="flex flex-wrap gap-2">
        {view.upcoming.map((e) => (
          <li key={e.id} className="min-w-0">
            <Link
              href={`/dashboard/events/${e.id}/edit?section=team`}
              className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-md border border-field-border bg-surface px-3 text-sm font-semibold hover:border-brand hover:bg-background"
            >
              <span className="[overflow-wrap:anywhere]">{e.name}</span>
              <span className="whitespace-nowrap font-normal text-muted">{short(e.starts_on)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One Volunteer Lead or Coordinator, every role they have, and one "Remove…". */
function PersonRow({ person, limited }: { person: Person; limited: boolean }) {
  const name = personName(person.profile);
  const choices: RemoveChoice[] = person.roles.map((r) => ({
    value: `${r.event.id}:${r.role}`,
    label: `${ROLE[r.role]} of ${r.event.name}`,
    leaves: leftEmpty(r),
  }));
  return (
    <Row
      title={name}
      detail={[person.profile.email, formatPhone(person.profile.phone)]}
      actions={
        <RemovePersonButton name={name} firstName={first(name)} choices={choices} limited={limited} action={removeFromEvents.bind(null, person.userId, name)} />
      }
    >
      <RoleLines roles={person.roles} link={(e) => `/dashboard/events/${e.id}/edit?section=team`} />
    </Row>
  );
}

/** What removing this role leaves without anyone. */
function leftEmpty(r: RoleOn) {
  if (r.role === "volunteer_director") return r.soleLead ? [`${r.event.name} will have no Volunteer Lead, so the Account Host and co-hosts run its volunteers`] : [];
  return r.soleJobs.map((job) => `${job} at ${r.event.name} will need a new Coordinator`);
}

function RoleLines({ roles, link }: { roles: RoleOn[]; link?: (e: TeamEvent) => string }) {
  return (
    <ul className="mt-2 space-y-1 text-sm leading-6">
      {roles.map((r) => (
        <li key={`${r.event.id}:${r.role}`}>
          <strong className="font-semibold">{ROLE[r.role]}</strong> ·{" "}
          {link ? (
            <Link href={link(r.event)} className={LINK}>
              {r.event.name}
            </Link>
          ) : (
            r.event.name
          )}{" "}
          <span className="text-muted">
            {short(r.event.starts_on)}
            {r.event.ended && " · Ended"}
            {r.jobs.length > 0 && ` · leads ${r.jobs.join(", ")}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function InviteRow({
  invite: inv,
  manage,
  what,
  full = false,
  limited = true,
}: {
  invite: Invite;
  manage: boolean;
  what: string;
  full?: boolean;
  /** The plan limits team spots (so cancelling frees one). */
  limited?: boolean;
}) {
  // An expired link says so first, and offers a new link instead of copying the dead one.
  return (
    <Row
      title={
        <>
          <span className="break-all">{inv.email}</span>{" "}
          {inv.expired ? <Badge tone="warning">Link expired</Badge> : <Badge tone="info">Invited</Badge>}
        </>
      }
      detail={[
        inv.expired ? `Link expired ${short(inv.expiresAt)}` : null,
        inv.event ? null : what,
        `Invited ${short(inv.createdAt)}`,
        inv.expired ? null : `Link works until ${short(inv.expiresAt)}`,
      ]}
      actions={
        <>
          {manage && inv.expired && full ? (
            // A new link would take a team spot back (the database checks the same).
            <p className="text-sm text-muted">Free a team spot to send a new link</p>
          ) : manage && (
            <RowButton
              action={resendTeamInvitation.bind(null, inv.id)}
              pendingText="Sending…"
              label={inv.expired ? `Send a new link to ${inv.email}` : `Resend to ${inv.email}`}
            >
              {inv.expired ? "Send a new link" : "Resend"}
            </RowButton>
          )}
          {!inv.expired && <CopyInviteLink url={inv.link} email={inv.email} />}
          {manage && (
            <ConfirmButton
              action={cancelTeamInvitation.bind(null, inv.id)}
              label={`Cancel invitation for ${inv.email}`}
              title={`Cancel the invitation for ${inv.email}?`}
              points={["Their link stops working right away", ...(limited ? ["A team spot opens up"] : []), "You can invite them again any time"]}
              keepLabel="Keep invitation"
              confirmLabel="Cancel invitation"
              pendingText="Canceling…"
            >
              Cancel invitation
            </ConfirmButton>
          )}
        </>
      }
    >
      {inv.event && (
        <p className="mt-1 text-sm leading-6">
          <strong className="font-semibold">{what}</strong> · {inv.event.name}{" "}
          <span className="text-muted">
            {short(inv.event.starts_on)}
            {inv.job && ` · to lead ${inv.job}`}
          </span>
        </p>
      )}
    </Row>
  );
}

function RemovedRecently({
  removed,
  orgId,
  events,
  jobs,
  roles,
  spotNote,
  blocked,
}: {
  removed: Removal[];
  orgId: string;
  events: TeamEvent[];
  jobs: Record<string, { id: string; name: string; led: boolean }[]>;
  /** The roles they may be invited back to. */
  roles?: StaffRole[];
  spotNote: string;
  /** Why they can't be invited again from here (shown in the button's place), or null. */
  blocked: (r: Removal) => string | null;
}) {
  if (!removed.length) return null;
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">Removed or left recently · {removed.length}</span>
        <span className="text-sm font-medium text-muted">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>
      <p className="border-t border-border px-4 pt-3 text-sm text-muted">The last 90 days. They can&apos;t see the account&apos;s events.</p>
      <ul className="divide-y divide-border">
        {removed.map((r) => (
          <Row
            key={r.id}
            title={r.name}
            detail={[
              r.name !== r.email ? r.email : null,
              r.event ? `${ROLE[r.role]} · ${r.event.name}` : ROLE[r.role],
              `${r.left ? "Left" : "Removed"} ${short(r.removedAt)}`,
            ]}
            actions={
              r.undoUntil ? (
                <p className="text-sm text-muted">Undo is at the top of the page</p>
              ) : blocked(r) ? (
                <p className="text-sm text-muted">{blocked(r)}</p>
              ) : (
                <InviteAgainButton
                  name={r.name}
                  email={r.email}
                  lastTime={r.event ? `${ROLE[r.role]} · ${r.event.name}` : null}
                  events={r.role === "co_host" ? null : againEvents(events)}
                  jobs={jobs}
                  roles={roles}
                  lastRole={r.role === "co_host" ? undefined : r.role}
                  spotNote={spotNote}
                  action={inviteAgain.bind(null, orgId, r.email, r.role)}
                />
              )
            }
          />
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------
// Volunteer Leads: their events' Coordinators
// ---------------------------------------------------------------------------------------------

function LeadSections({ view }: { view: LeadView }) {
  const upcoming = view.events.map((e) => e.event);
  return (
    <>
      <header>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">My team</h1>
        <p className="mt-2 text-muted">Coordinators on the events where you&apos;re the Volunteer Lead.</p>
      </header>
      <JustRemoved removed={view.removed} />
      {view.events.map(({ event, coordinators, invites }) => (
        <section key={event.id} aria-labelledby={`event-${event.id}`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`event-${event.id}`} className="text-xl font-semibold">
              {event.name}
            </h2>
            <span className="text-sm text-muted">{short(event.starts_on)}</span>
          </div>
          {coordinators.length || invites.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {coordinators.map((p) => {
                const name = personName(p.profile);
                const role = p.roles[0];
                return (
                  <Row
                    key={p.userId}
                    title={
                      <>
                        {name} <Badge tone="info">Coordinator</Badge>
                      </>
                    }
                    detail={[p.profile.email, formatPhone(p.profile.phone), role?.jobs.length ? `leads ${role.jobs.join(", ")}` : "No job yet"]}
                    actions={
                      role && (
                        <RemovePersonButton
                          name={name}
                          firstName={first(name)}
                          choices={[{ value: `${event.id}:section_lead`, label: `Coordinator of ${event.name}`, leaves: leftEmpty(role) }]}
                          action={removeFromEvents.bind(null, p.userId, name)}
                        />
                      )
                    }
                  />
                );
              })}
              {invites.map((inv) => (
                <InviteRow key={inv.id} invite={{ ...inv, event: null }} manage what="Coordinator" full={view.full} />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">No Coordinators yet</p>
          )}
          {view.full ? (
            <p className="text-sm text-muted">
              The team is full, so you can&apos;t add a Coordinator right now. Ask {view.accountHost ?? "the Account Host"} to free a spot.
            </p>
          ) : (
            <p className="text-sm">
              <Link href={`/dashboard/events/${event.id}/volunteering`} className={LINK}>
                Add a Coordinator in this event&apos;s volunteer setup
              </Link>
            </p>
          )}
        </section>
      ))}
      <RemovedRecently
        removed={view.removed}
        orgId=""
        events={upcoming}
        jobs={view.jobs}
        roles={["section_lead"]}
        spotNote={spotLine(null)}
        blocked={() => (view.full ? `The team is full. Ask ${view.accountHost ?? "the Account Host"} to free a spot` : null)}
      />
      <PrivacyNote>Only the Account Host, co-hosts, and the event&apos;s Volunteer Leads see Coordinators&apos; emails and phone numbers. {REMOVAL_NOTE}</PrivacyNote>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Your own roles: leave an event
// ---------------------------------------------------------------------------------------------

function MyRoles({ roles, other }: { roles: MyRole[]; other: boolean }) {
  const hosts = [...new Map(roles.filter((r) => r.accountHost).map((r) => [r.accountHost!.email, r.accountHost!])).values()];
  return (
    <section aria-labelledby="my-roles-heading" className="space-y-3">
      <h2 id="my-roles-heading" className="text-xl font-semibold">
        {other ? "Your roles on other accounts' events" : "Your roles"}
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {roles.map((r) => (
          <Row
            key={`${r.event.id}:${r.role}`}
            title={
              <>
                {ROLE[r.role]} ·{" "}
                <Link href={`/dashboard/events/${r.event.id}`} className={LINK}>
                  {r.event.name}
                </Link>
              </>
            }
            detail={[short(r.event.starts_on), r.jobs.length ? `leads ${r.jobs.join(", ")}` : null, r.accountHost ? `Account Host: ${r.accountHost.name}` : null]}
            after={
              r.leads.length > 0 && (
                <p className="mt-1 text-sm leading-6">
                  Volunteer Lead:{" "}
                  {r.leads.map((l, i) => (
                    <span key={l.email}>
                      {i > 0 && ", "}
                      <a href={`mailto:${l.email}`} className={LINK}>
                        {l.name}
                      </a>{" "}
                      <span className="text-muted [overflow-wrap:anywhere]">{l.email}</span>
                    </span>
                  ))}
                </p>
              )
            }
            actions={
              <ConfirmButton
                action={leaveEvent.bind(null, r.event.id, r.role, r.event.name)}
                label={`Leave this event: ${r.event.name}`}
                title={`Leave ${r.event.name}?`}
                points={[
                  "You lose access to this event right away",
                  ...(r.jobs.length ? [`You stop leading ${r.jobs.join(" and ")}, so ${r.jobs.length === 1 ? "it needs" : "they need"} a new Coordinator`] : []),
                  r.leads.length
                    ? `We'll let ${r.accountHost?.name ?? "the Account Host"} and ${r.leads.map((l) => l.name).join(" and ")} know by email`
                    : `We'll let ${r.accountHost?.name ?? "the Account Host"} know by email`,
                  `To come back, ask ${r.accountHost?.name ?? "the Account Host"} to invite you again`,
                ]}
                keepLabel="Stay on this event"
                confirmLabel="Leave this event"
                pendingText="Leaving…"
              >
                Leave this event
              </ConfirmButton>
            }
          />
        ))}
      </ul>
      {hosts.map((h) => (
        <p key={h.email} className="text-sm text-muted">
          {roles.some((r) => r.leads.length) ? "For anything else, contact " : "Questions? Contact "}
          <a href={`mailto:${h.email}`} className={LINK}>
            {h.name}
          </a>
          , Account Host
        </p>
      ))}
    </section>
  );
}

/** How your last offer of the Account Host role ended (shown for a week). */
function offerOutcome(o: NonNullable<HostView["lastOffer"]>, isAccountHost: boolean) {
  const on = short(o.on);
  const who = <strong className="font-semibold">{o.name}</strong>;
  const still = isAccountHost ? " You're still the Account Host, and can offer the role again any time." : "";
  switch (o.outcome) {
    case "accepted":
      return <>{who} accepted your offer on {on} and is the Account Host now.</>;
    case "declined":
      return <>{who} declined your offer of the Account Host role on {on}.{still}</>;
    case "expired":
      return <>Your offer to {who} expired on {on}.{still}</>;
    case "left":
      return <>Your offer to {who} ended on {on}, when they stopped being a co-host.</>;
    case "ended":
      return <>Your offer to {who} ended on {on}, when you removed them for a moment.{still}</>;
  }
}

/** How to pass the Account Host role on, with co-hosts to choose from or none yet. */
const PASS_ON = (coHosts: boolean) =>
  coHosts
    ? "Choose Offer Account Host role on their row. If they aren't a co-host yet, invite them as one first. They take over the plan, and you stay on as a co-host."
    : "Invite them as a co-host first. Once they join, you can offer them the Account Host role from their row. They take over the plan, and you stay on as a co-host.";

/** "a, b, and c". */
const listAnd = (items: string[]) => (items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`);

/**
 * Right after removing someone: what was removed, and one Undo until UNDO_MINUTES are up. One note
 * per person, covering every role removed at once.
 */
function JustRemoved({ removed }: { removed: Removal[] }) {
  const mine = removed.filter((r) => r.undoUntil);
  if (!mine.length) return null;
  // One note per removal: the same person's roles removed together (within a few seconds), not hours apart.
  const people: Removal[][] = [];
  for (const r of [...mine].sort((a, b) => a.removedAt.localeCompare(b.removedAt))) {
    const group = people.find((g) => g[0].email === r.email && Math.abs(new Date(g[0].removedAt).getTime() - new Date(r.removedAt).getTime()) < 10_000);
    if (group) group.push(r);
    else people.push([r]);
  }
  return (
    <section aria-label="Just removed" className="space-y-2">
      {people.map((rs) => {
        // The earliest end, so Undo never outlives any of the roles it puts back.
        const until = rs.map((r) => r.undoUntil!).sort()[0];
        const several = rs.length > 1;
        return (
          <UndoNote
            key={rs[0].id}
            until={until}
            minutes={UNDO_MINUTES}
            action={undoRemoval.bind(null, rs.map((r) => r.id))}
            name={rs[0].name}
          >
            <p>
              You removed <strong className="font-semibold">{rs[0].name}</strong> as{" "}
              {listAnd(rs.map((r) => (r.event ? `${ROLE[r.role]} of ${r.event.name}` : "co-host")))}.
            </p>
            <p className="text-muted">
              Undo puts them back {several ? "in each role" : "as before"}, with their jobs, and tells anyone we emailed.
            </p>
          </UndoNote>
        );
      })}
    </section>
  );
}

/** A co-host offered the Account Host role: what changes, and Accept or Decline right here. */
function OfferToMe({ offer, orgName }: { offer: NonNullable<HostView["offerToMe"]>; orgName: string }) {
  return (
    <section aria-labelledby="offer-heading" className="space-y-3 rounded-lg border border-brand/40 bg-brand-soft px-4 py-4">
      <h2 id="offer-heading" className="text-lg font-semibold">
        {offer.from} offered you the Account Host role
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
        <li>You&apos;d invite and remove {orgName}&apos;s co-hosts, get and renew the plan, and could hand the role on later</li>
        <li>The plan stays as it is until it ends. After that, renewing it is up to you</li>
        <li>Your access to events stays the same</li>
        <li>
          {offer.from} would become a co-host. Once you accept, they can&apos;t take the role back. Only you could offer it to them again
        </li>
        <li>Nothing changes until you accept. The offer is open through {short(offer.expiresOn)}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <RowButton action={acceptAccountHost.bind(null, offer.token)} pendingText="Accepting…" primary>
          Accept and become Account Host
        </RowButton>
        <ConfirmButton
          action={declineAccountHost.bind(null, offer.token)}
          label="Decline…"
          title="Decline the Account Host role?"
          points={[`${offer.from} stays the Account Host, and we'll let them know`, "You stay a co-host"]}
          keepLabel="Keep the offer open"
          confirmLabel="Decline"
          pendingText="Declining…"
          danger={false}
        >
          Decline…
        </ConfirmButton>
      </div>
    </section>
  );
}

/** One person or invitation: who, details, and buttons on the right (below on phones). */
function Row({
  title,
  detail,
  actions,
  children,
  after,
}: {
  title: ReactNode;
  detail: (string | null | undefined)[];
  actions?: ReactNode;
  children?: ReactNode;
  /** More lines under the details (same as children, for rows built with props). */
  after?: ReactNode;
}) {
  return (
    // Side by side only when the card itself is wide enough (not the screen: the accounts menu narrows it).
    <li className="@container">
      <div className="flex flex-col gap-3 px-4 py-3 @xl:flex-row @xl:items-start @xl:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-7 [overflow-wrap:anywhere]">{title}</p>
          <p className="text-sm leading-6 text-muted">{detail.filter(Boolean).join(" · ")}</p>
          {children}
          {after}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </li>
  );
}
