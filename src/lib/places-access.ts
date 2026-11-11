import "server-only";
import { getMyOrganization } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

/**
 * The address lookup (Google Places) is billed per use, so only hosts (who
 * pick event venues) and FieldCommand admins may call it. Directors and
 * everyone else are turned away.
 */
export async function canUsePlaces(): Promise<boolean> {
  if (await getMyOrganization()) return true;
  const supabase = await createClient();
  // A co-host of one event picks its venue too.
  const { data: user } = await supabase.auth.getUser();
  if (user.user) {
    const { count } = await supabase.from("event_staff").select("event_id", { count: "exact", head: true }).eq("user_id", user.user.id).eq("role", "co_host");
    if (count) return true;
  }
  return (await supabase.rpc("is_platform_admin")).data === true;
}
