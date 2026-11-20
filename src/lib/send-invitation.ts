import "server-only";
import { friendlyDbError } from "@/lib/action-state";
import { getOrigin } from "@/lib/data";
import { sendEmail } from "@/lib/email";
import { hasBands, leadWords } from "@/lib/event-types";
import { invitationEmail, invitationEmailKey, type InvitationDetails } from "@/lib/invitation-email";
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
  const { data: key } = await createAdminClient()
    .from("invitations")
    .select("email_token, events(event_type)")
    .eq("id", invitationId)
    .single();
  if (!key) return false;
  const url = `${await getOrigin()}/invite/${details.token}?k=${key.email_token}`;
  const eventType = (key.events as unknown as { event_type: string } | null)?.event_type;
  const saved = await loadSystemEmail(invitationEmailKey(details));
  const { subject, html, text } = invitationEmail(details, url, hasBands(eventType), leadWords(eventType).one, saved);
  return sendEmail({ to: details.email, subject, html, text });
}
