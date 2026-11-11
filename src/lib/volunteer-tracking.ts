import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type TrackingAccount = { id: string; name: string; isHost: boolean };

/**
 * The accounts whose volunteer tracking the signed-in user can see: those they
 * host or co-host, and those where they're a Volunteer Lead on any event. The
 * database checks the same rule again (can_see_volunteer_history).
 */
export async function trackingAccounts(userId: string): Promise<TrackingAccount[]> {
  const supabase = await createClient();
  const [{ data: hosted }, { data: leads }] = await Promise.all([
    // RLS shows only the accounts you host or co-host.
    supabase.from("organizations").select("id, name").order("created_at"),
    // Volunteer Leads and co-hosts of one event see their accounts' volunteer history (the database checks the 10 days).
    supabase.from("event_staff").select("events(organization_id)").eq("user_id", userId).in("role", ["volunteer_director", "co_host"]),
  ]);
  const accounts: TrackingAccount[] = (hosted ?? []).map((o) => ({ id: o.id, name: o.name, isHost: true }));
  const seen = new Set(accounts.map((a) => a.id));
  const ledIds = [
    ...new Set(
      ((leads ?? []) as unknown as { events: { organization_id: string } | null }[])
        .map((r) => r.events?.organization_id)
        .filter((id): id is string => !!id && !seen.has(id)),
    ),
  ];
  if (ledIds.length) {
    // Volunteer Leads can't read the account itself, only its name is needed here.
    const { data: led } = await createAdminClient().from("organizations").select("id, name").in("id", ledIds).order("created_at");
    accounts.push(...(led ?? []).map((o) => ({ id: o.id, name: o.name, isHost: false })));
  }
  return accounts;
}
