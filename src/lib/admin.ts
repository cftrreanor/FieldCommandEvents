import "server-only";
import { PILOT_END } from "@/lib/pilot";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { missing } from "@/lib/schema-check";
import { createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";
import { dollars, packageLabel, passFor, rateLabel } from "@/lib/plan";
import { invitePackageLabel, inviteStatusLabel } from "@/lib/invitation-plan";
import { systemEmail } from "@/lib/system-emails";

/**
 * For every admin page and action: a FieldCommand admin (platform_admins), or
 * "not found". Pages load with the server's key after this check.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  const { data, error } = await (await createClient()).rpc("is_platform_admin");
  if (error) missing();
  if (!data) notFound();
  return user;
}

/** The plans, in the words the dashboard uses. Pilot and Trial have a last free day. */
export const PLANS = [
  { value: "comped", label: "Pilot (free)", free: true },
  { value: "trialing", label: "Trial", free: true },
  { value: "active", label: "Paid", free: false },
  { value: "past_due", label: "Paid · payment late", free: false },
  { value: "canceled", label: "Canceled", free: false },
  { value: "none", label: "No plan", free: false },
] as const;
export type PlanStatus = (typeof PLANS)[number]["value"];

export const planLabel = (status: string) => PLANS.find((p) => p.value === status)?.label ?? status;
export const isFreePlan = (status: string) => PLANS.some((p) => p.value === status && p.free);

/** Default last day for a new pilot: the day the pilot ends (src/lib/pilot.ts). */
export const DEFAULT_PILOT_END = PILOT_END;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

/** Where a pilot or trial stands: "Free through Jan 1, 2027", "Ends in 12 days", "Ended Jan 1, 2027". */
export function freeStatus(org: { subscription_status: string; free_until: string | null; default_timezone: string }) {
  if (!isFreePlan(org.subscription_status) || !org.free_until) return null;
  const today = utcToZonedDate(new Date().toISOString(), org.default_timezone);
  const left = daysBetween(today, org.free_until);
  const day = formatDate(org.free_until, { weekday: undefined });
  if (left < 0) return { ended: true, soon: false, left, day, text: `Free period ended ${day}` };
  if (left <= 30)
    return { ended: false, soon: true, left, day, text: left === 0 ? "Free period ends today" : `Free period ends in ${left} day${left === 1 ? "" : "s"}` };
  return { ended: false, soon: false, left, day, text: `Free through ${day}` };
}

export type AdminLogRow = {
  id: string;
  action: string;
  details: {
    // plan_changed: status and free_until; package_changed: package and rate.
    // package_details_changed: name and prices; pass_price_changed: cents.
    // package_created: the code of the package it was copied from.
    from?: { status?: string; free_until?: string | null; package?: string; rate?: string; name?: string } | number | string;
    to?: { status?: string; free_until?: string | null; package?: string; rate?: string; name?: string } | number;
    package?: string;
    event_type?: string;
    price_cents?: number;
    source?: string;
    plan_status?: string | null;
    free_until?: string | null;
    note?: string | null;
    email?: string;
    unpublished?: number;
    key?: string;
    /** package_edited, package_details_changed, pass_price_changed, package_created/retired/restored: the package or pass. */
    code?: string;
    /** package_created, package_retired, package_restored: the package's name at the time. */
    name?: string;
  };
  created_at: string;
  admin: { full_name: string; email: string } | null;
  organization: { name: string } | null;
};

export const ADMIN_LOG_COLUMNS =
  "id, action, details, created_at, admin:profiles!admin_log_admin_id_fkey(full_name, email), organization:organizations!admin_log_organization_id_fkey(name)";

const planWithEnd = (p?: { status?: string; free_until?: string | null }) =>
  p ? `${planLabel(p.status ?? "?")}${p.free_until ? ` through ${formatDate(p.free_until, { weekday: undefined })}` : ""}` : "?";

/** ": Schedule Command, free pilot through Feb 1, 2027", or "" when nothing was chosen. */
function invitationChoices(r: AdminLogRow, names?: Record<string, string>) {
  const { package: pkg, plan_status: status, free_until: until } = r.details;
  const parts = [
    pkg ? invitePackageLabel(pkg, names) : null,
    status ? `${inviteStatusLabel(status).toLowerCase()}${until ? ` through ${formatDate(until, { weekday: undefined })}` : ""}` : null,
  ].filter(Boolean);
  return parts.length ? `: ${parts.join(", ")}` : "";
}

/** "Pilot (free) through Jan 1, 2027 → Paid" */
export function describeAdminLog(r: AdminLogRow, names?: Record<string, string>) {
  const fromObj = typeof r.details.from === "object" ? r.details.from : undefined;
  const toObj = typeof r.details.to === "object" ? r.details.to : undefined;
  if (r.action === "plan_changed") return `Plan: ${planWithEnd(fromObj)} → ${planWithEnd(toObj)}`;
  if (r.action === "invite_host") return `Invited ${r.details.email ?? "someone"} to host${invitationChoices(r, names)}`;
  if (r.action === "invitation_plan_changed") return `Changed ${r.details.email ?? "someone"}'s host invitation${invitationChoices(r, names) || ": nothing chosen"}`;
  if (r.action === "account_closed") return "Closed the account (deleted 90 days later)";
  if (r.action === "account_reopened") return "Reopened the account";
  if (r.action === "teacher_upgraded")
    return `Upgraded from a free teacher account to a full account${r.details.package ? ` on ${packageLabel(r.details.package, names)}` : ""}`;
  if (r.action === "package_changed") {
    const words = (p?: { package?: string; rate?: string }) => (p ? `${packageLabel(p.package ?? "?", names)}, ${rateLabel(p.rate ?? "?").toLowerCase()}` : "?");
    return `Package: ${words(fromObj)} → ${words(toObj)}${r.details.source === "payment" ? " (by payment)" : ""}`;
  }
  if (r.action === "pass_added")
    return `Added a ${passFor(r.details.event_type ?? "")?.label.toLowerCase() ?? "event"} pass (${dollars(r.details.price_cents ?? 0)})${r.details.source === "payment" ? " by payment" : ""}`;
  if (r.action === "account_suspended")
    return `Suspended the account${r.details.unpublished ? ` (${r.details.unpublished} event${r.details.unpublished === 1 ? "" : "s"} taken offline)` : ""}`;
  if (r.action === "account_unsuspended") return "Lifted the suspension";
  if (r.action === "sponsors_turned_on") return "Turned on the Sponsors add-on";
  if (r.action === "sponsors_turned_off") return "Turned off the Sponsors add-on (sponsors kept)";
  if (r.action === "package_edited") return `Changed what ${packageLabel(r.details.code ?? "?", names)} includes`;
  if (r.action === "package_created")
    return `Created ${r.details.name ?? packageLabel(r.details.code ?? "?", names)}${typeof r.details.from === "string" ? `, copied from ${packageLabel(r.details.from, names)}` : ""}`;
  if (r.action === "package_retired") return `Retired ${r.details.name ?? packageLabel(r.details.code ?? "?", names)}`;
  if (r.action === "package_restored") return `Brought back ${r.details.name ?? packageLabel(r.details.code ?? "?", names)}`;
  if (r.action === "package_details_changed") {
    const from = typeof r.details.from === "object" ? r.details.from : undefined;
    const to = typeof r.details.to === "object" ? r.details.to : undefined;
    return from?.name && to?.name && from.name !== to.name ? `Renamed ${from.name} to ${to.name}` : `Changed ${packageLabel(r.details.code ?? "?", names)}'s prices`;
  }
  if (r.action === "pass_price_changed")
    return `${packageLabel(r.details.code ?? "?", names)}: ${dollars(Number(r.details.from ?? 0))} → ${dollars(Number(r.details.to ?? 0))}`;
  if (r.action === "system_email_changed") return `Changed the wording of the “${systemEmail(r.details.key ?? "")?.name ?? r.details.key}” email`;
  if (r.action === "system_email_reset") return `Reset the “${systemEmail(r.details.key ?? "")?.name ?? r.details.key}” email to its original wording`;
  return r.action.replaceAll("_", " ");
}
