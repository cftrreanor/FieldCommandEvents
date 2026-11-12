"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { isFreePlan, PLANS, planLabel, requirePlatformAdmin } from "@/lib/admin";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { isPickablePackage, tierNames } from "@/lib/package-names";
import { dollars, isFreePackage, isRate, packageLabel, passFor, rateLabel } from "@/lib/plan";

/** Change an organization's plan. The database checks it's an admin and logs it. */
export async function setPlan(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const status = String(formData.get("status") ?? "");
  if (!PLANS.some((p) => p.value === status)) return { error: "Pick a plan." };
  const freeUntil = String(formData.get("freeUntil") ?? "");
  const free = isFreePlan(status);
  if (free && !/^\d{4}-\d{2}-\d{2}$/.test(freeUntil)) return { error: "Pick the last day of the free period." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan", {
    p_org: orgId,
    p_status: status,
    p_free_until: free ? freeUntil : null,
    p_note: note || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Saved: ${planLabel(status)}${free ? ` through ${formatDate(freeUntil)}` : ""}.` };
}

/** Close an account: 90 days later everything in it is deleted (purge_closed_accounts). */
export async function closeAccount(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_close_account", { p_org: orgId, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Account closed. Its events are offline, and it will be deleted in 90 days unless you reopen it." };
}

/** Reopen a closed account before it's deleted. */
export async function reopenAccount(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reopen_account", { p_org: orgId, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Account reopened. Nothing will be deleted." };
}

/** Make a free teacher account a full account (every event type). Its plan is set separately. */
export async function upgradeTeacher(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const pkg = String(formData.get("package") ?? "");
  if (!(await isPickablePackage(pkg)) || isFreePackage(pkg)) return { error: "Pick a package." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_upgrade_teacher", { p_org: orgId, p_package: pkg, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Upgraded to a full account on ${packageLabel(pkg, await tierNames())}. Set their plan under Details if it should change.` };
}

/** The account's package and rate: the only way either changes (set_account_package logs it). */
export async function setPackage(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const pkg = String(formData.get("package") ?? "");
  const rate = String(formData.get("rate") ?? "");
  // The account's own package stays pickable even once retired (to change only its rate).
  const { data: org } = await createAdminClient().from("organizations").select("package").eq("id", orgId).maybeSingle();
  if (!(await isPickablePackage(pkg, org?.package))) return { error: "Pick a package." };
  if (!isRate(rate)) return { error: "Pick a rate." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_package", { p_org: orgId, p_package: pkg, p_rate: rate, p_note: note || null, p_source: "admin" });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Saved: ${packageLabel(pkg, await tierNames())}, ${rateLabel(rate).toLowerCase()}.` };
}

/** A one-time event pass, at the price paid (add_event_pass logs it and adds it to the account's total). */
export async function addPass(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const pass = passFor(String(formData.get("type") ?? ""));
  if (!pass) return { error: "Pick an event pass." };
  const price = String(formData.get("price") ?? "").trim();
  if (!/^\d{1,5}$/.test(price)) return { error: "Enter the price paid in whole dollars, or 0." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_event_pass", {
    p_org: orgId,
    p_event_type: pass.type,
    p_note: note || null,
    p_source: "admin",
    p_price_cents: Number(price) * 100,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Added a ${pass.label.toLowerCase()} pass (${dollars(Number(price) * 100)}). It's good for 12 months.` };
}

/** Suspend an account: its published events go offline and it can't publish until unsuspended. */
export async function suspendAccount(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_suspend_account", { p_org: orgId, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  const n = Number(data ?? 0);
  return { ok: true, message: `Account suspended.${n ? ` ${n} event${n === 1 ? " was" : "s were"} taken offline.` : ""}` };
}

/** Lift a suspension. Events taken offline stay unpublished until the host publishes them again. */
export async function unsuspendAccount(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_unsuspend_account", { p_org: orgId, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Suspension lifted. The host can publish again." };
}

/** The Sponsors add-on on or off (admin_set_sponsors checks it's a platform admin and logs it). Off keeps every sponsor. */
export async function setSponsorsAddOn(orgId: string, on: boolean): Promise<ActionState> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_sponsors", { p_org: orgId, p_on: Boolean(on), p_note: null });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/e/[slug]", "page");
  return { ok: true, message: on ? "Sponsors turned on" : "Sponsors turned off. Every sponsor is kept" };
}
