import type { Metadata } from "next";
import Link from "next/link";
import { ADMIN_LOG_COLUMNS, DEFAULT_PILOT_END, describeAdminLog, freeStatus, isFreePlan, PLANS, planLabel, requirePlatformAdmin, type AdminLogRow } from "@/lib/admin";
import { ADMIN_TZ, ago, byNewest, stageLabel, type TimelineItem } from "@/lib/admin-crm";
import { eventTypeLabel } from "@/lib/event-types";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";
import { addPass, closeAccount, reopenAccount, setPackage, setPlan, suspendAccount, unsuspendAccount, upgradeTeacher } from "../../actions";
import { EMAIL_COLUMNS, loadAccount, NOTE_COLUMNS, signIns, type EmailRow, type NoteRow } from "../../data";
import { EmptyRow, Facts, HealthPill, PageHeader, Panel, RecordLink, Table, Tag, Td, Th, Tr } from "../../kit";
import { NoteComposer } from "../../note-composer";
import { addNote } from "../../notes-actions";
import { EmailPanel } from "../../email-panel";
import { emailItems, noteItems, Timeline } from "../../timeline";
import { ClosureForm, NoteActionForm } from "../closure-form";
import { PlanForm } from "../plan-form";
import { PackageForm, PassForm, TeacherUpgradeForm } from "../package-form";
import { loadTiers, packageChoices } from "@/lib/package-names";
import { dollars, loadAccountPlan, packageLabel, passFor, rateLabel, usageLines } from "@/lib/plan";

export const metadata: Metadata = { title: "Account" };

/** One host organization: its health, hosts, events, plan and everything that's happened. */
export default async function AccountPage({ params }: PageProps<"/admin/accounts/[accountId]">) {
  const tiers = await loadTiers();
  const names = Object.fromEntries(tiers.map((t) => [t.code, t.name]));
  const packageOptions = (keep?: string | null) => packageChoices(tiers, keep);
  const passPrices = Object.fromEntries(tiers.filter((t) => t.kind === "pass").map((t) => [t.event_types[0], t.price_cents ?? 0]));
  const user = await requirePlatformAdmin();
  const { accountId } = await params;
  const account = await loadAccount(accountId);
  if (!account) missing();

  const admin = createAdminClient();
  const eventIds = account.events.map((e) => e.id);
  // Groups and volunteers per event (counted in the database, so big events count right).
  const countPerEvent = async (table: "bands" | "volunteers") => {
    const counts = await Promise.all(
      eventIds.map((id) => admin.from(table).select("id", { count: "exact", head: true }).eq("event_id", id)),
    );
    return Object.fromEntries(eventIds.map((id, i) => [id, counts[i].count ?? 0])) as Record<string, number>;
  };
  const hostEmails = account.organization_members.map((m) => m.profiles?.email).filter((e): e is string => Boolean(e));
  const [{ data: requestData }, { data: logData }, { data: inviteData }, { data: emailData }, bands, volunteers, logins, closure] =
    await Promise.all([
      admin.from("pilot_requests").select("id, name, email, status, created_at").eq("organization_id", accountId),
      admin.from("admin_log").select(ADMIN_LOG_COLUMNS).eq("organization_id", accountId).order("created_at", { ascending: false }).limit(100),
      admin.from("host_invitations").select("email, invited_at, used_at").eq("organization_id", accountId),
      hostEmails.length
        ? admin.from("email_log").select(EMAIL_COLUMNS).in("to_email", hostEmails).order("created_at", { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
      countPerEvent("bands"),
      countPerEvent("volunteers"),
      signIns(),
      // Before 20261117000000_data_retention.sql there's no closed_at.
      admin.from("organizations").select("closed_at").eq("id", accountId).maybeSingle(),
    ]);
  const closable = !(closure.error && isSchemaError(closure.error));
  const closedAt = (closure.data as { closed_at: string | null } | null)?.closed_at ?? null;
  const deleteOn = formatDate(utcToZonedDate(new Date(Date.parse(closedAt ?? new Date().toISOString()) + 90 * 86_400_000).toISOString(), ADMIN_TZ), {
    weekday: undefined,
  });
  const requests = (requestData ?? []) as { id: string; name: string; email: string; status: string; created_at: string }[];
  const requestIds = requests.map((r) => r.id);
  const { data: noteData } = await admin
    .from("admin_notes")
    .select(NOTE_COLUMNS)
    .or([`organization_id.eq.${accountId}`, ...(requestIds.length ? [`pilot_request_id.in.(${requestIds.join(",")})`] : [])].join(","))
    .order("created_at", { ascending: false });
  const notes = (noteData ?? []) as unknown as NoteRow[];
  const log = (logData ?? []) as unknown as AdminLogRow[];
  const invites = (inviteData ?? []) as { email: string; invited_at: string; used_at: string | null }[];
  const today = utcToZonedDate(new Date().toISOString(), ADMIN_TZ);
  const free = freeStatus(account);
  const openFollowUps = notes.filter((n) => n.follow_up_on && !n.done_at);
  const events = [...account.events].sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const teacher = account.account_kind === "teacher";
  // Before 20261128000000_teacher_admin.sql there's no suspended_at.
  const suspendable = "suspended_at" in account;
  const suspendedAt = account.suspended_at ?? null;
  const published = account.events.filter((e) => e.status === "published").length;
  // Packages and passes: missing before 20261223000000_packages.sql.
  const hasPackages = "package" in account;
  const [plan, { data: passData }] = hasPackages
    ? await Promise.all([
        loadAccountPlan(admin, accountId),
        admin
          .from("event_passes")
          .select("id, event_type, price_cents, source, note, purchased_at, expires_at, used_at, event:events(id, name)")
          .eq("organization_id", accountId)
          .order("purchased_at", { ascending: false }),
      ])
    : [null, { data: [] }];
  type PassRow = {
    id: string;
    event_type: string;
    price_cents: number;
    source: string;
    note: string | null;
    purchased_at: string;
    expires_at: string;
    used_at: string | null;
    event: { id: string; name: string } | null;
  };
  const nowIso = new Date().toISOString();
  const passes = ((passData ?? []) as unknown as PassRow[]).map((p) => ({ ...p, expired: !p.used_at && p.expires_at < nowIso }));
  const shortDate = (iso: string) => formatDate(utcToZonedDate(iso, ADMIN_TZ), { weekday: undefined });

  const items: TimelineItem[] = [
    { at: account.created_at, kind: "account", title: "Organization set up" },
    ...requests.map((r) => ({
      at: r.created_at,
      kind: "pipeline" as const,
      title: `Pilot request from ${r.name}`,
      detail: `Stage: ${stageLabel(r.status)}`,
      href: `/admin/pipeline/${r.id}`,
    })),
    ...invites.map((i) => ({ at: i.invited_at, kind: "pipeline" as const, title: `Host invitation sent to ${i.email}` })),
    ...account.events.map((e) => ({
      at: e.created_at,
      kind: "event" as const,
      title: `Created ${e.name}`,
      detail: `${eventTypeLabel(e.event_type)} · ${formatDate(e.starts_on, { year: undefined })} · ${e.status}`,
    })),
    ...log.map((r) => ({
      at: r.created_at,
      kind: "admin" as const,
      title: describeAdminLog(r, names),
      detail: [r.details.note ? `“${r.details.note}”` : null, r.admin ? `by ${r.admin.full_name || r.admin.email}` : null].filter(Boolean).join(" · ") || null,
    })),
    ...noteItems(notes),
    ...emailItems((emailData ?? []) as unknown as EmailRow[], hostEmails.length > 1),
  ];
  items.sort(byNewest);

  const suspendBody = (
    <>
      <p className="mb-3 text-sm text-muted">
        {suspendedAt
          ? `Suspended ${formatDate(utcToZonedDate(suspendedAt, ADMIN_TZ), { weekday: undefined })}. Its events are offline and it can't publish. Lifting the suspension lets the host publish again; nothing republishes on its own.`
          : `Takes ${published ? `its ${published} published event${published === 1 ? "" : "s"}` : "any published events"} offline and stops it publishing until you lift the suspension. Nothing is deleted.`}
      </p>
      <NoteActionForm
        action={(suspendedAt ? unsuspendAccount : suspendAccount).bind(null, account.id)}
        label={suspendedAt ? "Lift suspension" : "Suspend account"}
        pendingText={suspendedAt ? "Lifting…" : "Suspending…"}
        danger={!suspendedAt}
        placeholder={suspendedAt ? "e.g. Sorted out with the school" : "e.g. Spam sign-up"}
        confirmMessage={
          suspendedAt
            ? undefined
            : `Suspend ${account.name}? ${published ? `Its ${published} published event${published === 1 ? " goes" : "s go"} offline right away` : "It"} and it can't publish until you lift the suspension.`
        }
      />
    </>
  );
  const closeBody = (
    <>
      {!closable ? (
        <p className="text-sm text-muted">Run the data retention database update (20261117000000_data_retention.sql) to close accounts.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {closedAt
              ? `Closed ${formatDate(utcToZonedDate(closedAt, ADMIN_TZ), { weekday: undefined })}. Its events are offline and it can't publish. On ${deleteOn} the organization, its events, and everyone's details in them are deleted, with the sign-in accounts of hosts and team members who have no other role. Reopen it to keep everything (the host publishes their events again).`
              : `Closing takes its published events offline now and starts the privacy policy's 90-day countdown: on ${deleteOn} the organization, its events, and everyone's details in them are deleted for good. You can reopen it any time before then.`}
          </p>
          <ClosureForm action={(closedAt ? reopenAccount : closeAccount).bind(null, account.id)} closed={Boolean(closedAt)} deleteOn={deleteOn} />
        </>
      )}
    </>
  );

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href="/admin/accounts" className="text-muted hover:text-foreground">
          ← Accounts
        </Link>
      </p>
      <PageHeader
        title={account.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <HealthPill level={account.health.level} />
            <Tag tone={account.subscription_status === "active" ? "success" : isFreePlan(account.subscription_status) ? "brand" : "neutral"}>
              {planLabel(account.subscription_status)}
            </Tag>
            {free && <span className={free.ended || free.soon ? "text-warning" : ""}>{free.text}</span>}
            <span>Joined {formatDate(utcToZonedDate(account.created_at, ADMIN_TZ), { weekday: undefined })}</span>
            {teacher && <Tag tone="brand">Teacher (free){account.school ? ` · ${account.school}` : ""}</Tag>}
            {suspendedAt && <Tag tone="danger">Suspended</Tag>}
            {closedAt && <Tag tone="warning">Closed · deleted {deleteOn}</Tag>}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Events (${events.length})`} flush>
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Type</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Groups</Th>
                  <Th className="text-right">Volunteers</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-medium">{e.name}</Td>
                    <Td className="whitespace-nowrap text-muted">{eventTypeLabel(e.event_type)}</Td>
                    <Td className={`whitespace-nowrap ${e.ends_on < today ? "text-muted" : ""}`}>{formatDate(e.starts_on, { year: undefined })}</Td>
                    <Td>
                      <Tag tone={e.status === "published" ? "success" : "neutral"}>{e.status === "published" ? "Published" : e.status === "draft" ? "Draft" : "Archived"}</Tag>
                    </Td>
                    <Td className="text-right">{bands[e.id] ?? 0}</Td>
                    <Td className="text-right">{volunteers[e.id] ?? 0}</Td>
                  </Tr>
                ))}
                {events.length === 0 && <EmptyRow cols={6}>No events yet.</EmptyRow>}
              </tbody>
            </Table>
          </Panel>

          <EmailPanel target={{ organizationId: account.id }} userId={user.id} />
          <Panel title="Timeline" flush>
            <div className="border-b border-border p-3">
              <NoteComposer action={addNote.bind(null, { organizationId: account.id })} />
            </div>
            <Timeline items={items} today={today} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Health">
            <HealthPill level={account.health.level} />
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-muted">
              {account.health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>

          {openFollowUps.length > 0 && (
            <Panel title="Open follow-ups">
              <ul className="space-y-2 text-sm">
                {openFollowUps.map((n) => (
                  <li key={n.id}>
                    <Tag tone={n.follow_up_on! <= today ? "warning" : "brand"}>{formatDate(n.follow_up_on!, { year: undefined })}</Tag>
                    <p className="mt-0.5 line-clamp-2">{n.body}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={`Hosts (${account.organization_members.length})`} flush>
            <ul className="divide-y divide-border">
              {account.organization_members.map((m) => (
                <li key={m.user_id} className="px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <RecordLink href={`/admin/people/${m.user_id}`}>{m.profiles?.full_name || m.profiles?.email || "Unknown"}</RecordLink>
                    <Tag>{m.role === "owner" ? "Owner" : "Co-host"}</Tag>
                  </div>
                  <p className="truncate text-xs text-muted">{m.profiles?.email}</p>
                  <p className="text-xs text-muted">Last sign-in {ago(logins.get(m.user_id)?.last_sign_in_at)}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Details">
            <Facts
              items={[
                ["Plan", planLabel(account.subscription_status)],
                ["Free through", account.free_until ? formatDate(account.free_until, { weekday: undefined }) : "—"],
                ...(hasPackages
                  ? ([
                      ["Package", `${packageLabel(account.package ?? "", names)}${plan && plan.active !== plan.package ? ` (publishing as ${plan.active_name} while the plan isn't active)` : ""}`],
                      ["Rate", rateLabel(account.rate ?? "")],
                      ["Event passes", `${dollars(account.pass_total_cents ?? 0)} in all`],
                    ] as [string, string][])
                  : []),
                ["Time zone", account.default_timezone.replace("America/", "").replaceAll("_", " ")],
                ["Pilot request", requests[0] ? <RecordLink href={`/admin/pipeline/${requests[0].id}`}>{stageLabel(requests[0].status)}</RecordLink> : "—"],
              ]}
            />
            <details className="mt-3 border-t border-border pt-3">
              <summary className="cursor-pointer text-sm font-semibold">Change plan</summary>
              <div className="mt-3">
                <PlanForm
                  action={setPlan.bind(null, account.id)}
                  plans={PLANS}
                  status={account.subscription_status}
                  freeUntil={account.free_until}
                  defaultEnd={DEFAULT_PILOT_END}
                />
              </div>
            </details>
            {hasPackages && (
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-semibold">Change package</summary>
                <div className="mt-3">
                  <PackageForm action={setPackage.bind(null, account.id)} pkg={account.package ?? "event"} rate={account.rate ?? "standard"} packages={packageOptions(account.package)} />
                </div>
              </details>
            )}
          </Panel>

          {plan && (
            <Panel title="Usage">
              <ul className="space-y-1 text-sm">
                {usageLines(plan).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Panel>
          )}

          {hasPackages && (
            <Panel title="Event passes">
              {passes.length ? (
                <ul className="mb-3 divide-y divide-border text-sm">
                  {passes.map((p) => {
                    const expired = p.expired;
                    return (
                      <li key={p.id} className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{passFor(p.event_type)?.label ?? p.event_type}</span>
                          <Tag tone={p.used_at ? "neutral" : expired ? "warning" : "success"}>{p.used_at ? "Used" : expired ? "Expired" : "Unused"}</Tag>
                          <span className="text-muted">{dollars(p.price_cents)}</span>
                        </div>
                        <p className="text-xs text-muted">
                          {p.source === "payment" ? "Paid" : "Added by an admin"} {shortDate(p.purchased_at)}
                          {p.used_at
                            ? p.event
                              ? <> · Used on <RecordLink href={`/dashboard/events/${p.event.id}`}>{p.event.name}</RecordLink></>
                              : " · Used on an event that was deleted"
                            : ` · ${expired ? "Expired" : "Good through"} ${shortDate(p.expires_at)}`}
                        </p>
                        {p.note && <p className="text-xs text-muted">{p.note}</p>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mb-3 text-sm text-muted">No event passes yet</p>
              )}
              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-semibold">Add event pass</summary>
                <div className="mt-3">
                  <PassForm action={addPass.bind(null, account.id)} prices={passPrices} />
                </div>
              </details>
            </Panel>
          )}

          {teacher && (
            <Panel title="Free teacher account">
              <p className="mb-3 text-sm text-muted">
                {account.school ? `${account.school}. ` : ""}Parent-teacher conferences only, one published at a time. Upgrading moves them to the
                package you pick; set their plan under Details afterwards.
              </p>
{hasPackages ? (
                <TeacherUpgradeForm action={upgradeTeacher.bind(null, account.id)} packages={packageOptions()} />
              ) : (
                <p className="text-sm text-muted">Run the packages database update to upgrade teacher accounts.</p>
              )}
            </Panel>
          )}

          {/* Suspending or closing is rare and serious: tucked away until needed, but shown open once it's done. */}
          {suspendedAt || closedAt ? (
            <>
              {suspendable && <Panel title={suspendedAt ? "Account suspended" : "Suspend account"}>{suspendBody}</Panel>}
              <Panel title={closedAt ? "Account closed" : "Close account"}>{closeBody}</Panel>
            </>
          ) : (
            <Panel>
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-danger">
                  Suspend or close this account
                </summary>
                <div className="space-y-5 border-t border-border p-3">
                  {suspendable && (
                    <section>
                      <h3 className="mb-1 text-sm font-semibold">Suspend account</h3>
                      {suspendBody}
                    </section>
                  )}
                  <section>
                    <h3 className="mb-1 text-sm font-semibold">Close account</h3>
                    {closeBody}
                  </section>
                </div>
              </details>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
