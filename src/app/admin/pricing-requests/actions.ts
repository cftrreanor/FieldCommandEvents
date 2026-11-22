"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/admin";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";

/** Mark a pricing request handled, or back to "to handle" (admin_set_pricing_request_handled logs it). */
export async function setRequestHandled(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const handled = formData.get("handled") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_pricing_request_handled", { p_id: id, p_handled: handled });
  if (error) return { error: friendlyDbError(error) };
  // The count in the admin menu.
  revalidatePath("/admin", "layout");
  return { ok: true, message: handled ? "Marked handled." : "Moved back to To handle." };
}
