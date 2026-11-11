"use server";

import { revalidatePath } from "next/cache";
import { EMAIL_LINK_DAYS, emailLinkCutoff } from "@/lib/email-link-age";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { sendEmail } from "@/lib/email";
import { addedEmail, cohostChangedEmail, hostOfferAnsweredEmail, hostOfferEmail, hostOfferEndedEmail, leftEventEmail, removedEmail, undoneEmail } from "@/lib/team-emails";
import { invitationEmail, invitationEmailKey, type InvitationDetails } from "@/lib/invitation-email";
import { loadSystemEmail } from "@/lib/system-email-overrides";
import { hasBands, leadWords } from "@/lib/event-types";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { utcToZonedDate } from "@/lib/time";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email address."),
  role: z.enum(["volunteer_director", "section_lead", "host", "co_host"]),
  stationId: z.string().uuid().or(z.literal("")).optional(),
});

export async function inviteMember(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  return invite(eventId, parsed.data.email, parsed.data.role, parsed.data.stationId || null);
}

/** Volunteer Setup's Coordinators window: invite someone to lead this one sign-up. */
export async function inviteCoordinator(eventId: string, stationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = inviteSchema.shape.email.safeParse(formData.get("email"));
  if (!email.success) return { error: email.error.issues[0].message };
  return invite(eventId, email.data, "section_lead", stationId);
}

/** Invite someone back to the role they were removed from. */
export async function reinviteMember(eventId: string, removalId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: removal } = await supabase.from("team_removals").select("email, role, event_id, was_every").eq("id", removalId).maybeSingle();
  if (!removal) return { error: "You don't have permission to do that." };
  // A co-host of one event is invited back to that event; a co-host of every event to the account.
  const role = removal.role === "co_host" ? (removal.event_id && !removal.was_every ? "co_host" : "host") : removal.role;
  return invite(eventId, removal.email, role, null);
}

async function invite(
  eventId: string,
  email: string,
  role: "volunteer_director" | "section_lead" | "host" | "co_host",
  stationId: string | null,
): Promise<ActionState> {
  const user = await requireUser();
  email = email.trim().toLowerCase();
  if (email === user.email.toLowerCase()) {
    return { error: "That's your own email. You're already on the team." };
  }

  const supabase = await createClient();
  const asHost = role === "host";
  // A co-host joins the whole account, not one event.
  if (asHost) {
    const { data: event } = await supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle();
    if (!event) return { error: "Event not found." };
    const result = await inviteToAccount(event.organization_id, email);
    revalidatePath(`/dashboard/events/${eventId}`, "layout");
    return result;
  }
  const { data, error } = await supabase
    .from("invitations")
    .insert({
      event_id: eventId,
      email,
      role,
      as_host: false,
      station_id: role === "section_lead" ? stationId : null,
      invited_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: `${email} already has an invitation waiting. Use Resend on their invitation.` };
    return { error: friendlyDbError(error) };
  }

  const sent = await sendInvitation(data.id);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard/team");
  return sent === true
    ? { ok: true, message: `Invitation sent to ${email}.` }
    : { ok: true, message: `Invitation saved, but the email didn't go out. Use Copy link on their invitation and send it to ${email} yourself.` };
}

export async function resendInvitation(eventId: string, invitationId: string): Promise<ActionState> {
  await requireUser();
  const sent = await sendInvitation(invitationId);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (typeof sent === "string") return { error: sent };
  return sent ? { ok: true, message: "Sent again." } : { error: "The email didn't go out. Copy the link and send it yourself." };
}

/** Emails an invitation with its one-tap link. Returns false if the email failed, or an error message. */
async function sendInvitation(invitationId: string): Promise<boolean | string> {
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

export async function cancelInvitation(eventId: string, invitationId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("invitations").delete().eq("id", invitationId);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

export async function removeMember(eventId: string, userId: string, role: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_staff")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .eq("role", role);
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Removes a co-host from the event's organization (the owner can't be removed). */
export async function removeCoHost(eventId: string, userId: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("organization_id").eq("id", eventId).maybeSingle();
  if (!event) return { error: "Event not found." };
  const { data, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", event.organization_id)
    .eq("user_id", userId)
    .eq("role", "admin")
    .select("user_id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "Only the Account Host can remove a co-host." };
  revalidatePath("/dashboard", "layout");
  // Leaving yourself: this event is no longer yours to see.
  if (userId === user.id) redirect("/dashboard");
  return { ok: true };
}

export async function acceptInvitation(token: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data: eventId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/dashboard");
  // An account (co-host) invitation has no event: go to the dashboard.
  redirect(eventId ? `/dashboard/events/${eventId}` : "/dashboard");
}

const joinSchema = z.object({ fullName: z.string().trim().max(200).optional() });

/**
 * One tap from the invitation email. The secret key in the link proves they
 * own the invited email (it's only ever sent there), so we sign them in as
 * that email (creating the account if needed) and accept the invitation.
 */
export async function joinFromEmail(token: string, key: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = joinSchema.safeParse({ fullName: formData.get("fullName") ?? undefined });
  if (!parsed.success) return { error: "Please enter your name." };
  const fullName = parsed.data.fullName ?? "";
  if (formData.has("fullName") && fullName.length < 2) return { error: "Please enter your first and last name." };
  if (!/^[0-9a-f-]{36}$/i.test(token) || !/^[0-9a-f-]{36}$/i.test(key)) return { error: "This link isn't valid." };

  const admin = createAdminClient();
  const { data: inv } = await admin
    .from("invitations")
    .select("email, expires_at, accepted_at, sent_at")
    .eq("token", token)
    .eq("email_token", key)
    .maybeSingle();
  if (!inv) return { error: "This link has been replaced by a newer email, or the invitation was canceled. Use the newest email, or ask for a new invitation." };
  if (inv.accepted_at) return { error: "This invitation has already been accepted. Sign in to continue." };
  if (new Date(inv.expires_at) < new Date()) return { error: "This invitation has expired. Ask for a new one." };
  // The one-tap sign-in works for a week after the email; after that, sign in normally.
  if (!inv.sent_at || inv.sent_at < emailLinkCutoff()) {
    return { error: `For your security, this email's join button only works for ${EMAIL_LINK_DAYS} days. Sign in with ${inv.email} to accept instead.` };
  }

  // Sign in as the invited email: an existing account, or a new one.
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email: inv.email });
  let type: "email" | "invite" = "email";
  if (link.error) {
    link = await admin.auth.admin.generateLink({ type: "invite", email: inv.email, options: { data: { full_name: fullName } } });
    type = "invite";
  }
  if (link.error) {
    console.error("Invitation sign-in link failed", link.error);
    return { error: "We couldn't sign you in. Please try again." };
  }
  const supabase = await createClient();
  const { data: session, error: signInError } = await supabase.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type });
  if (signInError || !session.user) {
    console.error("Invitation sign-in failed", signInError);
    return { error: "We couldn't sign you in. Please try again." };
  }
  if (fullName) {
    await admin.from("profiles").update({ full_name: fullName }).eq("id", session.user.id).eq("full_name", "");
  }

  const { data: eventId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/dashboard", "layout");
  redirect(eventId ? `/dashboard/events/${eventId}` : "/dashboard");
}

// -----------------------------------------------------------------------------
// My team (/dashboard/team). The database enforces who may do each of these
// (20270113000000_my_team.sql); a refused change comes back as nothing changed.
// -----------------------------------------------------------------------------

const STAFF_ROLES = ["volunteer_director", "section_lead"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const UUID = /^[0-9a-f-]{36}$/i;

/** Invite a co-host to the whole account (the Account Host only). */
export async function inviteCoHost(orgId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = inviteSchema.shape.email.safeParse(formData.get("email"));
  if (!email.success) return { error: email.error.issues[0].message, fieldErrors: { email: email.error.issues[0].message } };
  return inviteToAccount(orgId, email.data);
}

async function inviteToAccount(orgId: string, email: string): Promise<ActionState> {
  const user = await requireUser();
  if (email === user.email.toLowerCase()) return { error: "That's your own email. You're already on the team." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert({ organization_id: orgId, event_id: null, email, role: null, as_host: true, invited_by: user.id })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: `${email} already has an invitation waiting. Use Resend on their invitation.` };
    return { error: friendlyDbError(error) };
  }
  const sent = await sendInvitation(data.id);
  revalidatePath("/dashboard", "layout");
  return sent === true
    ? { ok: true, message: `Invitation sent to ${email}.` }
    : { ok: true, message: `Invitation saved, but the email didn't go out. Use Copy link on their invitation and send it to ${email} yourself.` };
}

/**
 * Invite someone back: a co-host to the account, or a Volunteer Lead or Coordinator to the event,
 * role, and (for a Coordinator) job picked in the window. `role` is their last role, used when the
 * window offers no choice.
 */
export async function inviteAgain(orgId: string, email: string, role: "co_host" | StaffRole, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (role === "co_host") return inviteToAccount(orgId, email.toLowerCase());
  const eventId = String(formData.get("eventId") ?? "");
  if (!UUID.test(eventId)) return { error: "Choose the event to invite them to.", fieldErrors: { eventId: "Choose the event to invite them to." } };
  const picked = String(formData.get("role") ?? role);
  const newRole: StaffRole = STAFF_ROLES.includes(picked as StaffRole) ? (picked as StaffRole) : role;
  const job = String(formData.get("stationId") ?? "");
  const result = await invite(eventId, email, newRole, newRole === "section_lead" && UUID.test(job) ? job : null);
  revalidatePath("/dashboard/team");
  return result;
}

export async function resendTeamInvitation(invitationId: string): Promise<ActionState> {
  await requireUser();
  const sent = await sendInvitation(invitationId);
  revalidatePath("/dashboard", "layout");
  if (typeof sent === "string") return { error: sent };
  return sent ? { ok: true, message: "Sent again." } : { error: "The email didn't go out. Use Copy link and send it yourself." };
}

export async function cancelTeamInvitation(invitationId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("invitations").delete().eq("id", invitationId).select("email");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "That invitation was already accepted or canceled, or isn't yours to cancel." };
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Invitation for ${data[0].email} canceled.` };
}

/**
 * Remove a Volunteer Lead or Coordinator from the roles picked in the window ("eventId:role" each).
 * Roles on events that are over are kept: they're the person's history (Past events, Invite again).
 */
export async function removeFromEvents(userId: string, name: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const pairs = formData
    .getAll("pick")
    .map((p) => String(p).split(":"))
    .filter(([eventId, role]) => UUID.test(eventId ?? "") && (STAFF_ROLES.includes(role as StaffRole) || role === "co_host"));
  if (!pairs.length) return { error: "Choose what to remove them from." };
  const { data: events } = await supabase
    .from("events")
    .select("id, name, ends_on, timezone, organization_id")
    .in("id", [...new Set(pairs.map(([eventId]) => eventId))]);
  const upcoming = new Set(
    (events ?? []).filter((e) => e.ends_on >= utcToZonedDate(new Date().toISOString(), e.timezone || "America/Chicago")).map((e) => e.id),
  );
  const current = pairs.filter(([eventId]) => upcoming.has(eventId));
  if (!current.length) return { error: `Those events are over, so ${name}'s roles stay in their history.` };
  // Before removing: the jobs they lead on those events (removing takes them off those).
  const { data: ledRows } = await supabase
    .from("station_leads")
    .select("event_id, stations(name)")
    .eq("user_id", userId)
    .in("event_id", [...new Set(current.map(([eventId]) => eventId))]);
  const { data, error } = await supabase
    .from("event_staff")
    .delete()
    .eq("user_id", userId)
    .or(current.map(([eventId, role]) => `and(event_id.eq.${eventId},role.eq.${role})`).join(","))
    .select("event_id, role");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: `${name} wasn't removed. They may have been removed already, or it isn't yours to do.` };
  const label = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator", co_host: "co-host" } as const;
  // The email names what was actually removed (not what was asked for).
  const roleNames = data.map((d) => `${label[d.role as StaffRole | "co_host"]} of ${(events ?? []).find((e) => e.id === d.event_id)?.name ?? "an event"}`);
  const toldPerson = await tellRemoved(formData, userId, (events ?? [])[0]?.organization_id ?? null, roleNames);
  // The event's Volunteer Leads (and the Account Host, if someone else did it) hear about the gap.
  const remover = await requireUser();
  const toldHosts: Record<string, string[]> = {};
  const { data: removerProfile } = await supabase.from("profiles").select("full_name").eq("id", remover.id).maybeSingle();
  const led = (ledRows ?? []) as unknown as { event_id: string; stations: { name: string } | null }[];
  await Promise.all(
    data.map((d) =>
      tellHostsSomeoneLeft(
        d.event_id,
        userId,
        name,
        d.role as StaffRole | "co_host",
        d.role === "section_lead" ? led.filter((l) => l.event_id === d.event_id).map((l) => l.stations?.name ?? "").filter(Boolean) : [],
        { id: remover.id, name: removerProfile?.full_name || remover.email },
        (toldHosts[d.event_id] ??= []),
      ),
    ),
  );
  await noteWhoWasTold(
    userId,
    remover.id,
    data.map((d) => ({ eventId: d.event_id, role: d.role as string, hosts: toldHosts[d.event_id] ?? [] })),
    toldPerson,
  );
  revalidatePath("/dashboard", "layout");
  const removed = new Set(data.map((d) => d.event_id)).size;
  return { ok: true, message: `Removed ${name} from ${removed === 1 ? "1 event" : `${removed} events`}.` };
}

/** Remove a co-host from the account (the Account Host), or stop being one (the co-host). */
export async function removeAccountCoHost(orgId: string, userId: string, name: string, _prev?: ActionState, formData?: FormData): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .select("user_id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) {
    revalidatePath("/dashboard", "layout");
    return { error: userId === user.id ? "You're no longer a co-host here. The page has been refreshed." : `${name} isn't a co-host anymore. The page has been refreshed.` };
  }
  if (userId !== user.id && formData) {
    const told = await tellRemoved(formData, userId, orgId, ["co-host"]);
    await noteWhoWasTold(userId, user.id, [{ eventId: null, role: "co_host", hosts: [] }], told, orgId);
  }
  revalidatePath("/dashboard", "layout");
  // Leaving yourself: the account's events are no longer yours to see.
  if (userId === user.id) redirect("/dashboard");
  return { ok: true, message: `Removed ${name} as co-host.` };
}

/**
 * A Volunteer Lead or Coordinator leaves one event. The Account Host and the event's other
 * Volunteer Leads are emailed, naming the jobs and roles left without anyone.
 */
export async function leaveEvent(eventId: string, role: StaffRole, eventName: string): Promise<ActionState> {
  const user = await requireUser();
  if (!STAFF_ROLES.includes(role)) return { error: "You don't have permission to do that." };
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("ends_on, timezone").eq("id", eventId).maybeSingle();
  if (ev && ev.ends_on < utcToZonedDate(new Date().toISOString(), ev.timezone || "America/Chicago")) {
    return { error: "That event is over, so there's nothing to leave. It stays in your history." };
  }
  // Before leaving: the jobs they lead (leaving takes them off those).
  const [{ data: led }, { data: me }] = await Promise.all([
    supabase.from("station_leads").select("stations(name)").eq("event_id", eventId).eq("user_id", user.id),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const { data, error } = await supabase
    .from("event_staff")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .eq("role", role)
    .select("event_id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You've already left that event." };
  const jobs = role === "section_lead" ? ((led ?? []) as unknown as { stations: { name: string } | null }[]).map((l) => l.stations?.name).filter((n): n is string => !!n) : [];
  const told = await tellHostsSomeoneLeft(eventId, user.id, me?.full_name || user.email, role, jobs);
  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    message: told ? `You've left ${eventName}. We've let ${told} know.` : `You've left ${eventName}. Let the Account Host know yourself: our email didn't go out.`,
  };
}

/**
 * Email the event's Account Host and Volunteer Leads that someone left or was removed, naming the
 * jobs now without anyone (server side: the people involved may not be able to read them). Never
 * the person themselves, or whoever removed them. Returns who was told, in words, or null when no
 * email went out.
 */
async function tellHostsSomeoneLeft(
  eventId: string,
  personId: string,
  who: string,
  role: StaffRole | "co_host",
  jobs: string[],
  removedBy: { id: string; name: string } | null = null,
  /** Filled with the addresses the email went to (so Undo can tell them). */
  sentTo: string[] = [],
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("id, name, starts_on, ends_on, organization_id").eq("id", eventId).maybeSingle();
  if (!event) return null;
  const [{ data: ownerRow }, { data: leads }] = await Promise.all([
    admin.from("organization_members").select("user_id, profiles(email)").eq("organization_id", event.organization_id).eq("role", "owner").maybeSingle(),
    admin.from("event_staff").select("user_id, profiles(email)").eq("event_id", eventId).eq("role", "volunteer_director"),
  ]);
  const owner = ownerRow as unknown as { user_id: string; profiles: { email: string } | null } | null;
  const skip = new Set([personId, removedBy?.id].filter(Boolean));
  const otherLeads = ((leads ?? []) as unknown as { user_id: string; profiles: { email: string } | null }[]).filter((l) => l.user_id !== personId);
  const leadsToTell = otherLeads.filter((l) => !skip.has(l.user_id));
  const tellOwner = owner && !skip.has(owner.user_id);
  const to = new Set(
    [tellOwner ? owner?.profiles?.email : null, ...leadsToTell.map((l) => l.profiles?.email)].filter((e): e is string => !!e).map((e) => e.toLowerCase()),
  );
  if (!to.size) return null;
  const { subject, html, text } = leftEventEmail({
    who,
    role,
    event,
    jobs,
    noLead: role === "volunteer_director" && otherLeads.length === 0,
    setupUrl: `${await getOrigin()}/dashboard/events/${eventId}/edit?section=team`,
    removedBy: removedBy?.name ?? null,
  });
  const sent = await Promise.all([...to].map((addr) => sendEmail({ to: addr, subject, html, text })));
  sentTo.push(...[...to].filter((_, i) => sent[i]));
  if (!sent.some(Boolean)) return null;
  const lead = leadsToTell.length ? `the event's Volunteer Lead${leadsToTell.length > 1 ? "s" : ""}` : null;
  return [tellOwner ? "the Account Host" : null, lead].filter(Boolean).join(" and ") || null;
}

/**
 * Email someone that they were removed, when the remover ticked "Let them know by email".
 * Returns the address it went to, or null.
 */
async function tellRemoved(formData: FormData, removedId: string, orgId: string | null, roles: string[]): Promise<string | null> {
  if (formData.get("notify") !== "on") return null;
  const user = await requireUser();
  const admin = createAdminClient();
  const [{ data: person }, { data: me }, { data: org }] = await Promise.all([
    admin.from("profiles").select("email").eq("id", removedId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    orgId ? admin.from("organizations").select("name").eq("id", orgId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!person?.email) return null;
  // The roles they keep on this account's events that aren't over, so the email doesn't say they're off the team.
  const today = new Date().toISOString().slice(0, 10);
  const { data: kept } = orgId
    ? await admin
        .from("event_staff")
        .select("role, events!inner(name, organization_id, ends_on)")
        .eq("user_id", removedId)
        .eq("events.organization_id", orgId)
        .gte("events.ends_on", today)
    : { data: [] };
  const label = { volunteer_director: "Volunteer Lead", section_lead: "Coordinator", co_host: "co-host" } as const;
  const keeps = ((kept ?? []) as unknown as { role: StaffRole | "co_host"; events: { name: string } }[]).map((k) => `${label[k.role]} of ${k.events.name}`);
  const { subject, html, text } = removedEmail({
    remover: me?.full_name || user.email,
    organization: org?.name ?? null,
    roles,
    keeps,
    contact: user.email,
  });
  return (await sendEmail({ to: person.email, subject, html, text, replyTo: user.email })) ? person.email : null;
}

/**
 * Note who was emailed about a removal, so Undo can send them a short "never mind"
 * (team_removal_notices: server only). The removals are the ones just recorded by the database.
 */
async function noteWhoWasTold(
  userId: string,
  removerId: string,
  removed: { eventId: string | null; role: string; hosts: string[] }[],
  person: string | null,
  orgId?: string,
) {
  if (!person && !removed.some((r) => r.hosts.length)) return;
  const admin = createAdminClient();
  let query = admin
    .from("team_removals")
    .select("id, event_id, role")
    .eq("user_id", userId)
    .eq("removed_by", removerId)
    .gte("removed_at", new Date(Date.now() - 5 * 60_000).toISOString());
  if (orgId) query = query.eq("organization_id", orgId);
  const { data: rows } = await query;
  const notices = (rows ?? []).flatMap((row) => {
    const match = removed.find((r) => r.eventId === row.event_id && r.role === row.role);
    if (!match) return [];
    return [
      ...(person ? [{ removal_id: row.id, email: person.toLowerCase(), to_person: true }] : []),
      ...match.hosts.map((email) => ({ removal_id: row.id, email: email.toLowerCase(), to_person: false })),
    ];
  });
  if (!notices.length) return;
  const { error } = await admin.from("team_removal_notices").upsert(notices, { onConflict: "removal_id,email", ignoreDuplicates: true });
  // Undo would then send no "never mind" emails; say so in the server log.
  if (error) console.error("Couldn't note who was told about a removal", error);
}

/** The part-3 functions' messages are written for people (even "not allowed" ones): show them. */
function teamDbError(error: { code?: string; message: string }) {
  return error.code === "42501" && !/^(permission denied|new row violates)/i.test(error.message) ? error.message : friendlyDbError(error);
}

// -----------------------------------------------------------------------------
// Handing on the Account Host role (20270113000000_my_team.sql, 20270120000000_undo_and_handing_on.sql:
// offer_account_host, close_account_host_offer, accept_account_host). Tokens stay on the server.
// -----------------------------------------------------------------------------

/** The Account Host offers their role to a co-host, who accepts by email. A replaced offer's co-host is told. */
export async function offerAccountHost(orgId: string, userId: string, name: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const before = await openOffer(orgId);
  // The offer's id comes back, never its token: that's read here, on the server, for the email.
  const { data: id, error } = await supabase.rpc("offer_account_host", { p_org: orgId, p_user: userId });
  if (error) return { error: teamDbError(error) };
  if (before && before.to_user !== userId) await tellOfferEnded(orgId, before.to_user, user, "replaced");
  const { data: offer } = await admin.from("account_host_handoffs").select("token, expires_at").eq("id", id as string).maybeSingle();
  revalidatePath("/dashboard/team");
  const sent = offer ? await sendOfferEmail(orgId, userId, offer.token, offer.expires_at, user) : false;
  // The first email counts toward Resend's wait.
  if (sent) await admin.from("account_host_handoffs").update({ last_sent_at: new Date().toISOString() }).eq("id", id as string);
  return {
    ok: true,
    message: sent
      ? `Offer sent to ${name}. Nothing changes until they accept.`
      : `Offer saved, but the email didn't go out. Ask ${name} to open My team to accept.`,
  };
}

/** Send the offer email again (the Account Host only: the database checks it's still theirs). */
export async function resendAccountHostOffer(orgId: string, name: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_org_owner", { org: orgId });
  const offer = isOwner ? await openOffer(orgId) : null;
  if (!offer || offer.offered_by !== user.id) {
    revalidatePath("/dashboard/team");
    return { error: "That offer isn't open anymore. The page has been refreshed." };
  }
  // One email every RESEND_MINUTES: claim the send first, so two quick clicks send one email.
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RESEND_MINUTES * 60_000).toISOString();
  const { data: claimed } = await admin
    .from("account_host_handoffs")
    .update({ last_sent_at: new Date().toISOString() })
    .eq("token", offer.token)
    .or(`last_sent_at.is.null,last_sent_at.lt.${cutoff}`)
    .select("token");
  if (!claimed?.length) {
    // Not an error: the email already went out. Say so, and when they can send it again.
    const wait = Math.max(1, Math.ceil((new Date(offer.last_sent_at ?? Date.now()).getTime() + RESEND_MINUTES * 60_000 - Date.now()) / 60_000));
    return {
      ok: true,
      message: `Already sent to ${name} a few minutes ago. Ask them to check their spam folder. You can send it again in about ${wait === 1 ? "1 minute" : `${wait} minutes`}.`,
    };
  }
  const sent = await sendOfferEmail(orgId, offer.to_user, offer.token, offer.expires_at, user);
  // Didn't go out: don't make them wait to try again.
  if (!sent) await admin.from("account_host_handoffs").update({ last_sent_at: offer.last_sent_at }).eq("token", offer.token);
  return sent ? { ok: true, message: `Offer email sent to ${name} again. If it doesn't arrive in a few minutes, ask them to check their spam folder.` } : { error: `The email didn't go out. Ask ${name} to open My team to accept.` };
}

/** How long Resend email waits between sends of the same offer. */
const RESEND_MINUTES = 10;

/** The open offer for an account, read on the server (its token never reaches the page). */
async function openOffer(orgId: string) {
  const { data } = await createAdminClient()
    .from("account_host_handoffs")
    .select("token, to_user, offered_by, expires_at, last_sent_at")
    .eq("organization_id", orgId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data as { token: string; to_user: string; offered_by: string | null; expires_at: string; last_sent_at: string | null } | null;
}

async function sendOfferEmail(orgId: string, userId: string, token: string, expiresAt: string, from: { id: string; email: string }) {
  const admin = createAdminClient();
  const [{ data: person }, { data: me }, { data: org }] = await Promise.all([
    admin.from("profiles").select("email").eq("id", userId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", from.id).maybeSingle(),
    admin.from("organizations").select("name, default_timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (!person?.email) return false;
  const { subject, html, text } = hostOfferEmail({
    from: me?.full_name || from.email,
    organization: org?.name ?? "your account",
    url: `${await getOrigin()}/account-host/${token}`,
    // The last day it's open, in the account's time zone.
    lastDay: utcToZonedDate(new Date(new Date(expiresAt).getTime() - 1000).toISOString(), org?.default_timezone || "America/Chicago"),
  });
  return sendEmail({ to: person.email, subject, html, text, replyTo: from.email });
}

/** Tell a co-host their offer was withdrawn, or replaced by an offer to someone else. */
async function tellOfferEnded(orgId: string, userId: string, from: { id: string; email: string }, reason: "withdrawn" | "replaced") {
  const admin = createAdminClient();
  const [{ data: person }, { data: me }, { data: org }] = await Promise.all([
    admin.from("profiles").select("email").eq("id", userId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", from.id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  if (!person?.email) return;
  const { subject, html, text } = hostOfferEndedEmail({ from: me?.full_name || from.email, organization: org?.name ?? "your account", reason });
  await sendEmail({ to: person.email, subject, html, text, replyTo: from.email });
}

/** The Account Host withdraws their open offer to this co-host (the one on screen); the co-host is told. */
export async function withdrawAccountHostOffer(orgId: string, userId: string, name: string): Promise<ActionState> {
  const user = await requireUser();
  const offer = await openOffer(orgId);
  if (!offer || offer.to_user !== userId) {
    revalidatePath("/dashboard/team");
    return { error: "That offer isn't open anymore. The page has been refreshed." };
  }
  // The database checks it's the Account Host closing it.
  const { error } = await (await createClient()).rpc("close_account_host_offer", { p_token: offer.token, p_as: "withdrawn" });
  if (error) return { error: teamDbError(error) };
  await tellOfferEnded(orgId, offer.to_user, user, "withdrawn");
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: `Offer withdrawn. We've let ${name} know. You're still the Account Host.` };
}

/** The co-host declines the offer sent to them (by its token); the Account Host is told. */
export async function declineAccountHost(token: string): Promise<ActionState> {
  const user = await requireUser();
  if (!UUID.test(token)) return { error: "This link isn't valid." };
  const supabase = await createClient();
  const { data: offer } = await supabase.rpc("get_account_host_offer", { p_token: token });
  const orgId = (offer as { organization_id: string | null }[] | null)?.[0]?.organization_id;
  const { error } = await supabase.rpc("close_account_host_offer", { p_token: token, p_as: "declined" });
  if (error) return { error: teamDbError(error) };
  if (orgId) await tellAccountHostAnswered(orgId, user.id, user.email, false);
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: "You declined. You're still a co-host, and we've let the Account Host know." };
}

/** The co-host accepts: they become the Account Host, and the old one a co-host. */
export async function acceptAccountHost(token: string): Promise<ActionState> {
  const user = await requireUser();
  if (!UUID.test(token)) return { error: "This link isn't valid." };
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_account_host", { p_token: token });
  if (error) return { error: teamDbError(error) };
  if (!orgId) {
    // Already accepted (a second tap, another tab): nobody is emailed twice.
    const { data: offer } = await supabase.rpc("get_account_host_offer", { p_token: token });
    const org = (offer as { organization_id: string | null }[] | null)?.[0]?.organization_id;
    redirect(org ? `/dashboard/team?account=${org}` : "/dashboard/team");
  }
  await tellAccountHostAnswered(orgId as string, user.id, user.email, true);
  revalidatePath("/dashboard", "layout");
  // My team then says what changed (see the note under its heading).
  redirect(`/dashboard/team?account=${orgId}&became=host`);
}

/** Email whoever made the offer that it was accepted or declined. */
async function tellAccountHostAnswered(orgId: string, userId: string, email: string, accepted: boolean) {
  const admin = createAdminClient();
  const [{ data: offer }, { data: me }, { data: org }] = await Promise.all([
    admin
      .from("account_host_handoffs")
      .select("profiles!account_host_handoffs_offered_by_fkey(email)")
      .eq("organization_id", orgId)
      .eq("to_user", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  const to = (offer as unknown as { profiles: { email: string } | null } | null)?.profiles?.email;
  if (!to) return;
  const { subject, html, text } = hostOfferAnsweredEmail({
    who: me?.full_name || email,
    organization: org?.name ?? "your account",
    accepted,
    url: `${await getOrigin()}/dashboard/team?account=${orgId}`,
  });
  await sendEmail({ to, subject, html, text, replyTo: email });
}

/**
 * Undo removing someone, within UNDO_MINUTES and only by whoever removed them: they're put back
 * in each role (with their jobs), and anyone emailed about the removal gets a short "never mind".
 */
export async function undoRemoval(removalIds: string[]): Promise<ActionState> {
  const user = await requireUser();
  const ids = removalIds.filter((id) => UUID.test(id));
  if (!ids.length) return { error: "Nothing to undo." };
  const admin = createAdminClient();
  // Read before undoing: undoing clears the removal and what it noted.
  const { data: notices } = await admin.from("team_removal_notices").select("removal_id, email, to_person").in("removal_id", ids);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_team_removals", { p_ids: ids });
  if (error) return { error: teamDbError(error) };
  const restored = (data ?? []) as { removal_id: string; full_name: string; role: string; event_name: string | null }[];
  if (!restored.length) return { error: "That can't be undone anymore. Use Invite again instead." };
  const roleName = (r: (typeof restored)[number]) =>
    r.role === "co_host" ? "a co-host" : `${r.role === "volunteer_director" ? "Volunteer Lead" : "Coordinator"} of ${r.event_name ?? "an event"}`;
  const who = restored[0].full_name;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const byEmail = new Map<string, { toPerson: boolean; roles: string[] }>();
  for (const n of (notices ?? []) as { removal_id: string; email: string; to_person: boolean }[]) {
    const r = restored.find((x) => x.removal_id === n.removal_id);
    if (!r) continue;
    const entry = byEmail.get(n.email) ?? { toPerson: n.to_person, roles: [] };
    entry.roles.push(roleName(r));
    byEmail.set(n.email, entry);
  }
  const sent = await Promise.all(
    [...byEmail].map(([to, { toPerson, roles }]) => {
      const { subject, html, text } = undoneEmail({ who, remover: me?.full_name || user.email, roles: [...new Set(roles)], toPerson });
      return sendEmail({ to, subject, html, text, replyTo: user.email });
    }),
  );
  revalidatePath("/dashboard", "layout");
  const told = sent.filter(Boolean).length;
  return {
    ok: true,
    message: `${who} is back as ${listAnd([...new Set(restored.map(roleName))])}, with their jobs.${
      told ? ` We've emailed ${told === 1 ? "the 1 person" : `the ${told} people`} we told about the removal.` : ""
    }`,
  };
}

/** "a, b, and c". */
function listAnd(items: string[]) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// -----------------------------------------------------------------------------
// Co-hosts of one event, and adding people already on the team (20270128000100_event_cohosts.sql).
// -----------------------------------------------------------------------------

const ADD_ROLES = ["co_host", "co_host_every", "volunteer_director", "section_lead"] as const;
const addSchema = z.object({ userId: z.string().regex(UUID), name: z.string().max(200), role: z.enum(ADD_ROLES) });

/** "From your team": add someone already on the team, right away, and email them. */
export async function addTeamMember(eventId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Something went wrong. Please try again." };
  const { userId, name, role } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_team_member", { p_event: eventId, p_user: userId, p_role: role });
  if (error) return { error: teamDbError(error) };
  const admin = createAdminClient();
  const [{ data: event }, { data: person }, { data: me }] = await Promise.all([
    admin.from("events").select("name, event_type, organizations(name)").eq("id", eventId).maybeSingle(),
    admin.from("profiles").select("email").eq("id", userId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const ev = event as unknown as { name: string; event_type: string; organizations: { name: string } | null } | null;
  const lead = leadWords(ev?.event_type ?? "volunteer").one;
  const label =
    role === "co_host_every"
      ? "co-host of every event"
      : role === "co_host"
        ? `co-host of ${ev?.name}`
        : role === "volunteer_director"
          ? `Volunteer Lead of ${ev?.name}`
          : `${lead} at ${ev?.name}`;
  const powers =
    role === "co_host_every"
      ? "You can see and run every event on the account, and any added later, except inviting or removing co-hosts and deleting events."
      : role === "co_host"
        ? `You can do everything on ${ev?.name} except invite or remove co-hosts, or delete it. Your access ends 10 days after the event.`
        : role === "volunteer_director"
          ? "You'll set up sign-ups and shifts, see who's signed up, check people in, and help run the event day."
          : "You'll see who's on your sign-up's shifts, and their phone numbers unlock on the day of the event.";
  let told = false;
  if (person?.email) {
    const { subject, html, text } = addedEmail({
      adder: me?.full_name || user.email,
      organization: ev?.organizations?.name ?? "your organizer",
      role: label,
      powers,
      url: `${await getOrigin()}/dashboard`,
      contact: user.email,
    });
    told = await sendEmail({ to: person.email, subject, html, text, replyTo: user.email });
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard/team");
  return { ok: true, message: told ? `Added ${name}. We emailed them.` : `Added ${name}. Our email didn't go out, so let them know yourself.` };
}

/**
 * Remove… on a co-host from an event's team setup. A co-host of every event: "event" takes them off this event (they
 * stay a co-host of each other open event), "all" off the account. A co-host of one event: off this event.
 */
export async function removeEventCoHost(
  eventId: string,
  userId: string,
  name: string,
  every: boolean,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const pick = formData.get("pick");
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("name, organization_id").eq("id", eventId).maybeSingle();
  if (!event) return { error: "Event not found." };
  if (every && pick === "all") {
    return removeAccountCoHost(event.organization_id, userId, name, _prev, formData);
  }
  if (every) {
    const { error } = await supabase.rpc("remove_cohost_from_event", { p_event: eventId, p_user: userId });
    if (error) return { error: teamDbError(error) };
  } else {
    const { data, error } = await supabase
      .from("event_staff")
      .delete()
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .eq("role", "co_host")
      .select("user_id");
    if (error) return { error: friendlyDbError(error) };
    if (!data?.length) return { error: "Only the Account Host can remove a co-host." };
  }
  const told = await tellRemoved(formData, userId, event.organization_id, [`co-host of ${event.name}`]);
  await noteWhoWasTold(userId, user.id, [{ eventId, role: "co_host", hosts: [] }], told, event.organization_id);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard/team");
  return { ok: true, message: `Removed ${name} from ${event.name}. Undo is on My team for 10 minutes.` };
}

/** Change… : a co-host of one event (or some) to every event, or a co-host of every event to just this one. */
export async function changeCoHost(
  orgId: string,
  userId: string,
  name: string,
  to: "every" | "only",
  eventId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("change_cohost", { p_org: orgId, p_user: userId, p_to: to, p_event: eventId });
  if (error) return { error: teamDbError(error) };
  if (formData.get("notify") === "on") {
    const admin = createAdminClient();
    const [{ data: person }, { data: me }, { data: org }, { data: ev }] = await Promise.all([
      admin.from("profiles").select("email").eq("id", userId).maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      eventId ? admin.from("events").select("name").eq("id", eventId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (person?.email) {
      const { subject, html, text } = cohostChangedEmail({
        changer: me?.full_name || user.email,
        organization: org?.name ?? "your organizer",
        every: to === "every",
        eventName: ev?.name ?? null,
        url: `${await getOrigin()}/dashboard`,
        contact: user.email,
      });
      await sendEmail({ to: person.email, subject, html, text, replyTo: user.email });
    }
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true, message: to === "every" ? `${name} is now a co-host of every event.` : `${name} now co-hosts just that event.` };
}

/** A co-host of one event stops co-hosting it. The Account Host is told. */
export async function stopCohosting(eventId: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: led }, { data: me }] = await Promise.all([
    supabase.from("station_leads").select("stations(name)").eq("event_id", eventId).eq("user_id", user.id),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const { data, error } = await supabase
    .from("event_staff")
    .delete()
    .eq("event_id", eventId)
    .eq("user_id", user.id)
    .eq("role", "co_host")
    .select("event_id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You've already stopped co-hosting that event." };
  const jobs = ((led ?? []) as unknown as { stations: { name: string } | null }[]).map((l) => l.stations?.name).filter((n): n is string => !!n);
  await tellHostsSomeoneLeft(eventId, user.id, me?.full_name || user.email, "co_host", jobs);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}
