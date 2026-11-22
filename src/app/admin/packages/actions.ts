"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";
import { friendlyDbError } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { error: string };

/** Package changes show on the pricing page (when it's live) and in the app's plan messages. */
function revalidatePackages() {
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/pricing");
}

export type PackageValues = {
  event_types: string[];
  one_at_a_time: string[];
  max_team: number | null;
  event_staff: boolean;
  volunteer_history: boolean;
  weekly_hours: boolean;
};

export type Impact = {
  accounts: number;
  affected: { id: string; name: string; detail: string }[];
};

/** Who a change would affect, before saving (admin_package_impact). */
export async function packageImpact(code: string, row: string, setting: string | null, maxTeam: number | null): Promise<Impact | { error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_package_impact", {
    p_code: code,
    p_row: row,
    p_setting: setting,
    p_max_team: maxTeam,
  });
  if (error) return { error: friendlyDbError(error) };
  return data as Impact;
}

/** Save what a package includes (admin_update_package checks and logs it). */
export async function savePackage(code: string, values: PackageValues, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_package", {
    p_code: code,
    p_event_types: values.event_types,
    p_one_at_a_time: values.one_at_a_time,
    p_max_team: values.max_team,
    p_event_staff: values.event_staff,
    p_volunteer_history: values.volunteer_history,
    p_weekly_hours: values.weekly_hours,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

/** Save an event pass's list price, in whole dollars (admin_set_pass_price logs it). */
export async function savePassPrice(code: string, dollars: number, note: string): Promise<Result> {
  await requirePlatformAdmin();
  if (!Number.isInteger(dollars) || dollars < 0 || dollars > 100000) return { error: "Enter a price in whole dollars, or 0." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_pass_price", {
    p_code: code,
    p_price_cents: dollars * 100,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

export type PackageDetails = {
  name: string;
  /** Whole dollars, or null for "not set". */
  month: number | null;
  year: number | null;
  teacher_month: number | null;
  teacher_year: number | null;
};

/** Rename a package or set its prices (admin_update_package_details checks and logs it). */
export async function savePackageDetails(code: string, d: PackageDetails, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const cents = (v: number | null) => (v == null ? null : Math.round(v * 100));
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_package_details", {
    p_code: code,
    p_name: d.name,
    p_month_cents: cents(d.month),
    p_year_cents: cents(d.year),
    p_teacher_month_cents: cents(d.teacher_month),
    p_teacher_year_cents: cents(d.teacher_year),
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

/** A new package, copied from an existing one, prices not set (admin_create_package checks and logs it). */
export async function createPackage(name: string, from: string, note: string): Promise<{ ok: true; code: string } | { error: string }> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_package", {
    p_name: name.trim(),
    p_from: from,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true, code: String(data) };
}

/** Retire a package (it stays on its accounts, but isn't offered) or bring it back (admin_set_package_retired logs it). */
export async function setPackageRetired(code: string, retired: boolean, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_package_retired", {
    p_code: code,
    p_retired: retired,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

/** A package's website settings, saved together (admin_set_package_website checks and logs them). */
export async function savePackageWebsite(code: string, w: { show: boolean; bestFor: string | null; recommended: boolean }, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_package_website", {
    p_code: code,
    p_show: w.show,
    p_best_for: w.bestFor?.trim() || null,
    p_recommended: w.recommended,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

/** Show an event pass on the pricing page, or hide it (admin_set_pass_shown logs it). */
export async function setPassShown(code: string, show: boolean, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_pass_shown", {
    p_code: code,
    p_show: show,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  return { ok: true };
}

/**
 * Put the pricing page live, or hide it (admin_set_pricing_page refuses live with no package cards, and logs it).
 * The home page, menus, footer, audience pages, and sitemap link to it only while it's live, so they refresh too.
 */
export async function setPricingPage(live: boolean, note: string): Promise<Result> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_pricing_page", {
    p_live: live,
    p_note: note.trim().slice(0, 500) || null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePackages();
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  return { ok: true };
}
