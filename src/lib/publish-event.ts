import "server-only";
import { revalidatePath } from "next/cache";
import { ensureDirectorContact } from "@/app/dashboard/band-registration-actions";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

/**
 * Publishes or unpublishes an event as the signed-in person, so the database's plan checks (publish_gate) and
 * every publishing rule run. Publishing can set volunteer sign-up open or closed in the same step, so it never goes
 * live half done.
 */
export async function changePublished(eventId: string, publish: boolean, signupOpen?: boolean): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update(publish ? { status: "published", ...(signupOpen === undefined ? {} : { volunteer_signup_open: signupOpen }) } : { status: "draft", volunteer_signup_open: false })
    .eq("id", eventId)
    .select("id, event_type");
  if (error) {
    // Plan limits say what's included and how to get more (friendlyDbError passes them through).
    if (error.code === "42501" && !error.message.startsWith("Your ")) {
      return { error: `Publishing needs an active ${brand.name} plan for your organization. Write to us at ${brand.supportEmail}.` };
    }
    return { error: friendlyDbError(error) };
  }
  if (!data?.length) return { error: "Only the event's host can publish it." };
  // Directors always have someone to call: the host's details, if no contact was saved.
  if (publish && data[0].event_type === "band_contest") await ensureDirectorContact(eventId);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}
