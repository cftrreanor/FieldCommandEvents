import type { Metadata } from "next";
import { DEFAULT_PILOT_END, requirePlatformAdmin } from "@/lib/admin";
import { ADMIN_TZ, ago, STAGES } from "@/lib/admin-crm";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";
import { loadTemplates } from "../data";
import { PageHeader, primarySmall } from "../kit";
import { moveStage } from "../notes-actions";
import { sendHostInvitation } from "./actions";
import { invitePackageChoices, loadTiers, tierNames } from "@/lib/package-names";
import { InviteHostPanel } from "./invite-host-panel";
import { PipelineBoard, type BoardCard } from "./board";

export const metadata: Metadata = { title: "Pipeline" };

type Request = {
  id: string;
  name: string;
  organization: string;
  status: string;
  contest_when: string | null;
  bands: number | null;
  volunteers: number | null;
  stage_changed_at: string;
  organization_id: string | null;
};

/** "Moved just now", "3 h in stage", "12 days in stage". */
function inStage(iso: string) {
  const a = ago(iso);
  if (a === "just now" || a === "today") return "Moved just now";
  if (a === "yesterday") return "1 day in stage";
  return a.endsWith(" ago") ? `${a.replace(" ago", "")} in stage` : `In stage since ${a}`;
}

/** Pilot requests from the home page, as a board: new → contacted → invited → set up → active. */
export default async function PipelinePage() {
  const names = await tierNames();
  const invitePackages = invitePackageChoices(await loadTiers());
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const [{ data }, { data: noteData }, templates] = await Promise.all([
    admin
      .from("pilot_requests")
      .select("id, name, organization, status, contest_when, bands, volunteers, stage_changed_at, organization_id")
      .order("created_at", { ascending: false }),
    admin.from("admin_notes").select("pilot_request_id, follow_up_on").not("pilot_request_id", "is", null).not("follow_up_on", "is", null).is("done_at", null),
    loadTemplates(),
  ]);
  const requests = (data ?? []) as Request[];
  const today = utcToZonedDate(new Date().toISOString(), ADMIN_TZ);
  const nextFollowUp = new Map<string, string>();
  for (const n of (noteData ?? []) as { pilot_request_id: string; follow_up_on: string }[]) {
    const had = nextFollowUp.get(n.pilot_request_id);
    if (!had || n.follow_up_on < had) nextFollowUp.set(n.pilot_request_id, n.follow_up_on);
  }

  const cards: BoardCard[] = requests.map((r) => {
    const f = nextFollowUp.get(r.id);
    return {
      id: r.id,
      organization: r.organization,
      name: r.name,
      status: r.status,
      when: r.contest_when,
      size: [r.bands != null ? `${r.bands} bands` : null, r.volunteers != null ? `${r.volunteers} volunteers` : null].filter(Boolean).join(", ") || null,
      inStage: inStage(r.stage_changed_at),
      followUp: f ? { date: formatDate(f, { weekday: undefined, year: undefined }), due: f <= today } : null,
      accountId: r.organization_id,
    };
  });
  const open = requests.filter((r) => r.status !== "declined" && r.status !== "active" && r.status !== "teacher").length;

  return (
    <div>
      <PageHeader
        title="Pipeline"
        sub={`${requests.length} pilot request${requests.length === 1 ? "" : "s"} · ${open} in progress. Inviting a host, their setting up, and their first published event move cards along on their own.`}
        actions={
          <InviteHostPanel
            names={names}
                  packages={invitePackages}
            action={sendHostInvitation.bind(null, null)}
            templates={templates.map((t) => ({ id: t.id, name: t.name }))}
            defaults={{ email: "", name: "", organization: "", phone: "", package: "event", status: "comped", freeUntil: DEFAULT_PILOT_END, template: "" }}
            label="Invite a host"
            buttonClassName={primarySmall}
          />
        }
      />
      <PipelineBoard stages={STAGES} cards={cards} move={moveStage} />
    </div>
  );
}
