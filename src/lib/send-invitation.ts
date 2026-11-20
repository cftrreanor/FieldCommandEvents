import "server-only";
import { friendlyDbError } from "@/lib/action-state";
import { getOrigin } from "@/lib/data";
import { sendEmail } from "@/lib/email";
import { hasBands, leadWords } from "@/lib/event-types";
import { invitationEmail, invitationEmailKey, type CopiedInvitation, type InvitationDetails } from "@/lib/invitation-email";
import { loadSystemEmail } from "@/lib/system-email-overrides";
import { createAdminClient, createClient } from "@/lib/supabase/server";

/**
 * Emails a team invitation with its one-tap link, as the signed-in person (prepare_invitation_email checks they may,
 * starts the invitation's 30 days, and clears a held invitation's hold). Returns true when the email went out, false if
 * the email failed, or the database's reason it couldn't be sent.
 */
export async function sendInvitation(invitationId: string): Promise<boolean | string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prepare_invitation_email", { p_id: invitationId }).single();
  if (error) return friendlyDbError(error);
  const details = data as InvitationDetails;
  // The secret key is only readable with the server's private key.
  const admin = createAdminClient();
  const { data: key } = await admin
    .from("invitations")
    .select("email_token, events(event_type, status)")
    .eq("id", invitationId)
    .single();
  if (!key) return false;
  const url = `${await getOrigin()}/invite/${details.token}?k=${key.email_token}`;
  const event = key.events as unknown as { event_type: string; status: string } | null;
  const eventType = event?.event_type;
  const saved = await loadSystemEmail(invitationEmailKey(details));
  const copy = await copiedInvitation(invitationId, event?.status === "draft");
  const { subject, html, text } = invitationEmail(details, url, hasBands(eventType), leadWords(eventType).one, saved, copy);
  return sendEmail({ to: details.email, subject, html, text });
}

/**
 * A duplicated event's Coordinator invitation (Duplicate event, 2026-11-20): the event it was copied from, every job
 * it covers, and whoever is sending it, for the email's extra paragraph. Null for any other invitation (or before
 * the database update).
 */
async function copiedInvitation(invitationId: string, early: boolean): Promise<CopiedInvitation | null> {
  const admin = createAdminClient();
  const { data: inv, error } = await admin.from("invitations").select("copied_from_event_id, station_id, extra_station_ids").eq("id", invitationId).maybeSingle();
  if (error || !inv?.copied_from_event_id) return null;
  const supabase = await createClient();
  const [{ data: source }, { data: stations }, { data: auth }] = await Promise.all([
    admin.from("events").select("name, starts_on").eq("id", inv.copied_from_event_id).maybeSingle(),
    admin
      .from("stations")
      .select("id, name, sort_order")
      .in("id", [inv.station_id, ...((inv.extra_station_ids as string[] | null) ?? [])].filter(Boolean))
      .order("sort_order"),
    supabase.auth.getUser(),
  ]);
  if (!source) return null;
  const me = auth.user ? (await admin.from("profiles").select("full_name, email").eq("id", auth.user.id).maybeSingle()).data : null;
  const names = (stations ?? []).map((st) => st.name as string);
  const jobs = names.length > 2 ? `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}` : names.join(" and ");
  const hostEmail = me?.email ?? auth.user?.email ?? "";
  return {
    sourceName: source.name,
    sourceStartsOn: source.starts_on,
    jobs: jobs || null,
    hostFirst: (me?.full_name ?? "").trim().split(/\s+/)[0] || hostEmail,
    hostEmail,
    early,
  };
}
