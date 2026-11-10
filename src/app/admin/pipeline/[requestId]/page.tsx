import type { Metadata } from "next";
import { pilotEventTypeLabels } from "@/lib/pilot";
import Link from "next/link";
import { DEFAULT_PILOT_END, requirePlatformAdmin } from "@/lib/admin";
import { invitePackageLabel, inviteStatusLabel } from "@/lib/invitation-plan";
import { ADMIN_TZ, byNewest, STAGES, stageLabel, type TimelineItem } from "@/lib/admin-crm";
import { formatPhone } from "@/lib/phone";
import { isSchemaError, missing } from "@/lib/schema-check";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";
import { EMAIL_COLUMNS, loadTemplates, NOTE_COLUMNS, type EmailRow, type NoteRow } from "../../data";
import { Facts, PageHeader, Panel, primarySmall, RecordLink, secondarySmall, Tag } from "../../kit";
import { NoteComposer } from "../../note-composer";
import { addNote, moveStage } from "../../notes-actions";
import { EmailPanel } from "../../email-panel";
import { emailItems, noteItems, Timeline } from "../../timeline";
import { sendHostInvitation } from "../actions";
import { invitePackageChoices, loadTiers, tierNames } from "@/lib/package-names";
import { InviteHostPanel } from "../invite-host-panel";
import { StageSelect } from "../stage-select";

export const metadata: Metadata = { title: "Pilot request" };

type Invitation = {
  invited_at: string;
  used_at: string | null;
  expires_at: string;
  /** Missing before 20261224000000_invitation_plan.sql; null when nothing was chosen. */
  package?: string | null;
  plan_status?: string | null;
  free_until?: string | null;
};

/** The host invitation for this email, with its package and plan when the database has them. */
async function selectInvitation(admin: ReturnType<typeof createAdminClient>, email: string) {
  const q = (columns: string) => admin.from("host_invitations").select(columns).eq("email", email).maybeSingle<Invitation>();
  const res = await q("invited_at, used_at, expires_at, package, plan_status, free_until");
  return isSchemaError(res.error) ? q("invited_at, used_at, expires_at") : res;
}

/** One pilot request: who asked, where it stands, and the conversation so far. */
export default async function PilotRequestPage({ params }: PageProps<"/admin/pipeline/[requestId]">) {
  const names = await tierNames();
  const tiers = await loadTiers();

  const user = await requirePlatformAdmin();
  const { requestId } = await params;
  const admin = createAdminClient();
  const { data: r } = await admin.from("pilot_requests").select("*").eq("id", requestId).maybeSingle();
  if (!r) missing();

  const email = String(r.email).toLowerCase();
  const [{ data: invite }, { data: noteData }, { data: emailData }, { data: person }, { data: account }, templates] = await Promise.all([
    selectInvitation(admin, email),
    admin.from("admin_notes").select(NOTE_COLUMNS).eq("pilot_request_id", requestId).order("created_at", { ascending: false }),
    admin.from("email_log").select(EMAIL_COLUMNS).eq("to_email", email).order("created_at", { ascending: false }).limit(50),
    admin.from("profiles").select("id, full_name").eq("email", email).maybeSingle(),
    r.organization_id ? admin.from("organizations").select("id, name").eq("id", r.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    loadTemplates(),
  ]);
  const today = utcToZonedDate(new Date().toISOString(), ADMIN_TZ);
  const inv = invite;
  const inviteText = !inv
    ? "Not invited yet"
    : inv.used_at
      ? `Used ${formatDate(utcToZonedDate(inv.used_at, ADMIN_TZ), { weekday: undefined })}`
      : new Date(inv.expires_at) < new Date()
        ? `Expired ${formatDate(utcToZonedDate(inv.expires_at, ADMIN_TZ), { weekday: undefined })}`
        : `Sent ${formatDate(utcToZonedDate(inv.invited_at, ADMIN_TZ), { weekday: undefined })}, open until ${formatDate(utcToZonedDate(inv.expires_at, ADMIN_TZ), { weekday: undefined, year: undefined })}`;

  const items: TimelineItem[] = [
    { at: r.created_at, kind: "pipeline", title: `${r.name} asked to join the pilot` },
    ...(inv ? [{ at: inv.invited_at, kind: "pipeline" as const, title: "Host invitation sent" }] : []),
    ...(inv?.used_at ? [{ at: inv.used_at, kind: "account" as const, title: "Set up their organization", href: account ? `/admin/accounts/${account.id}` : undefined }] : []),
    ...noteItems((noteData ?? []) as unknown as NoteRow[]),
    ...emailItems((emailData ?? []) as unknown as EmailRow[]),
  ];
  items.sort(byNewest);

  return (
    <div>
      <p className="mb-2 text-sm">
        <Link href="/admin/pipeline" className="text-muted hover:text-foreground">
          ← Pipeline
        </Link>
      </p>
      <PageHeader
        title={r.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tag tone={r.status === "declined" ? "neutral" : "brand"}>{stageLabel(r.status)}</Tag>
            <span>
              {r.organization && r.organization !== r.name ? `${r.organization} · ` : ""}
              <a href={`mailto:${r.email}`} className="text-brand underline underline-offset-4">
                {r.email}
              </a>
              {r.phone ? ` · ${formatPhone(r.phone)}` : ""}
            </span>
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Panel title="Request">
            <Facts
              items={[
                ["Event types", pilotEventTypeLabels(r.event_types).join(", ") || "—"],
                ...(r.contest_name ? [["Contest", r.contest_name] as [string, string]] : []),
                ...(r.contest_when ? [["When", r.contest_when] as [string, string]] : []),
                ...(r.bands != null ? [["Bands", r.bands] as [string, number]] : []),
                ...(r.volunteers != null ? [["Volunteers", r.volunteers] as [string, number]] : []),
                ["Sent", formatDate(utcToZonedDate(r.created_at, ADMIN_TZ), { weekday: undefined })],
              ]}
            />
            {r.notes && <p className="mt-3 rounded-sm bg-background px-3 py-2 text-sm whitespace-pre-line">{r.notes}</p>}
          </Panel>
          <EmailPanel target={{ pilotRequestId: r.id }} userId={user.id} />
          <Panel title="Timeline" flush>
            <div className="border-b border-border p-3">
              <NoteComposer action={addNote.bind(null, { pilotRequestId: r.id })} />
            </div>
            <Timeline items={items} today={today} />
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Stage">
            <StageSelect stages={STAGES} value={r.status} move={moveStage.bind(null, r.id)} />
          </Panel>
          <Panel title="Host invitation">
            <p className="text-sm">{inviteText}</p>
            {inv?.package && (
              <p className="mt-1 text-sm text-muted">
                {invitePackageLabel(inv.package, names)}
                {inv.plan_status && inv.free_until
                  ? `, ${inviteStatusLabel(inv.plan_status).toLowerCase()} through ${formatDate(inv.free_until, { weekday: undefined })}`
                  : ""}
              </p>
            )}
            {inv?.used_at ? (
              inv.package && <p className="mt-1 text-xs text-muted">Applied to their account when they set up. Change it on their account page.</p>
            ) : (
              <div className="mt-2">
                <InviteHostPanel
                  names={names}
                  packages={invitePackageChoices(tiers, inv?.package ?? r.planned_package)}
                  action={sendHostInvitation.bind(null, r.id)}
                  templates={templates.map((t) => ({ id: t.id, name: t.name }))}
                  defaults={{
                    email: r.email,
                    name: r.name,
                    // A card added from the panel without an organization shows the person's name.
                    organization: r.organization === r.name ? "" : r.organization,
                    phone: formatPhone(r.phone) ?? "",
                    // The invitation's choices, or what was saved with "Save and invite later".
                    package: inv?.package ?? r.planned_package ?? "event",
                    status: inv?.plan_status ?? r.planned_status ?? "comped",
                    freeUntil: inv?.free_until ?? r.planned_free_until ?? DEFAULT_PILOT_END,
                    template: r.planned_template ?? "",
                  }}
                  waiting={Boolean(inv)}
                  label={inv ? "Change or send again" : "Invite as host"}
                  buttonClassName={`${inv ? secondarySmall : primarySmall} w-full`}
                />
              </div>
            )}
          </Panel>
          <Panel title="Linked">
            <Facts
              items={[
                ["Account", account ? <RecordLink href={`/admin/accounts/${account.id}`}>{account.name}</RecordLink> : "Not set up yet"],
                ["Person", person ? <RecordLink href={`/admin/people/${person.id}`}>{person.full_name || r.email}</RecordLink> : "No account yet"],
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
