"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { copyCopiedFiles, loadCopyCoordinators, type CopiedFile, type DuplicateResult } from "@/lib/duplicate-event";
import { FILES_BUCKET } from "@/lib/event-files";
import { changePublished } from "@/lib/publish-event";
import { publishAndOpenBandRegistration } from "./band-actions";
import { sendInvitation } from "@/lib/send-invitation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, utcToZonedDate } from "@/lib/time";

// Duplicate event (owner decisions: docs/design-decisions/2026-11-20-duplicate-event.md). Every rule is in the
// database (20270207000000_duplicate_event.sql): who may duplicate, what comes over, held invitations, and Delete
// and start over. These actions add the stored files, the emails, and what each screen shows next.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEPS = ["details", "jobs", "registration", "volunteers", "rooms"] as const;

export type DuplicateState = ActionState & {
  eventId?: string;
  /** A retry found the copy the first try made. */
  existing?: boolean;
  summary?: DuplicateResult["summary"];
  /** Maps and documents whose stored file didn't copy (the copy was still made). */
  filesNotCopied?: Pick<CopiedFile, "label" | "file_name">[];
};

/**
 * Duplicate event: a new draft from `fromEventId` with the name and new first day typed. `requestId` is made once
 * per Duplicate page, so a double press or a retry after a dropped connection returns the copy that exists. Lands
 * where the copy is checked: a band contest's Band registration (a blank deadline holds back publishing there),
 * otherwise the event page.
 */
export async function duplicateEvent(fromEventId: string, requestId: string, _prev: DuplicateState, formData: FormData): Promise<DuplicateState> {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const startsOn = String(formData.get("startsOn") ?? "");
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Fill in the name of the new event";
  else if (name.length > 120) fieldErrors.name = "Keep the name under 120 characters";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fieldErrors.startsOn = "Pick the new date";
  if (Object.keys(fieldErrors).length) {
    const n = Object.keys(fieldErrors).length;
    return { error: n === 1 ? `${Object.values(fieldErrors)[0]} in the box above.` : `Fix the ${n} answers marked above.`, fieldErrors };
  }
  if (!UUID.test(fromEventId) || !UUID.test(requestId)) return { error: "Nothing was created. Try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_event", {
    p_from: fromEventId,
    p_new_first_day: startsOn,
    p_name: name,
    p_request_id: requestId,
  });
  if (error || !data) {
    if (error?.code === "P0001" && /first day/.test(error.message)) return { error: error.message, fieldErrors: { startsOn: error.message } };
    if (error?.code === "P0001" && /name/.test(error.message)) return { error: error.message, fieldErrors: { name: error.message } };
    if (error) console.error("Duplicating an event failed", error.code, error.message);
    return { error: error && (error.code === "42501" || error.code === "P0001") ? friendlyDbError(error) : "Nothing was created. Try again." };
  }
  const result = data as DuplicateResult;
  const { failed } = await copyCopiedFiles(result.event_id, result.files ?? [], result.existing);
  // A contest's copy lands on Band registration, so that step is opened by landing there (marked here, so every
  // screen agrees from the first render).
  if (result.summary.kind === "band_contest") {
    await supabase.rpc("mark_copy_step", { p_event: result.event_id, p_step: "registration" });
  }

  revalidatePath("/dashboard", "layout");
  const base = `/dashboard/events/${result.event_id}`;
  return {
    ok: true,
    eventId: result.event_id,
    existing: result.existing,
    summary: result.summary,
    filesNotCopied: failed.map((f) => ({ label: f.label, file_name: f.file_name })),
    goTo: `${result.summary.kind === "band_contest" ? `${base}/bands` : base}?copied=1`,
  };
}

/** A copied step was opened: that checks it off ("Copied: check it" becomes "Opened"). */
export async function markCopyStep(eventId: string, step: string): Promise<ActionState> {
  await requireUser();
  if (!UUID.test(eventId) || !STEPS.includes(step as (typeof STEPS)[number])) return { error: "That step isn't on this event." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_copy_step", { p_event: eventId, p_step: step });
  if (error) return { error: friendlyDbError(error) };
  return { ok: true };
}

/** Send now: email one copied Coordinator their invitation before publishing (the window confirms first). */
export async function sendCopyInvitationNow(eventId: string, invitationId: string): Promise<ActionState> {
  await requireUser();
  const person = (await loadCopyCoordinators(eventId)).find((c) => c.invitation_id === invitationId);
  if (!person) return { error: "That invitation isn't on this event anymore. Refresh to see the team." };
  if (person.status === "accepted") return { error: `${person.name} has already accepted.` };
  // A sent one can be sent again too (a send cut off partway may never have been delivered): a new invitation.
  const sent = await sendCopyInvitation(invitationId, person.status);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (sent !== true) return { error: sent };
  return { ok: true, message: `Invitation sent to ${person.name}.` };
}

/**
 * Sends one copied invitation. If the email didn't go out, it goes back to where it was, so nobody holds a link that
 * was never delivered: one never emailed goes back to "Not emailed yet", and one that had expired to expired. One
 * still marked sent (Send a new invitation) is left exactly as it was: its first email, and that link, still stand.
 * Returns true, or why it wasn't sent.
 */
async function sendCopyInvitation(invitationId: string, was: "held" | "expired" | "sent" = "held"): Promise<true | string> {
  // What a sent one looked like before: prepare_invitation_email gives it a new one-tap key and send time.
  const admin = createAdminClient();
  const before =
    was === "sent"
      ? (await admin.from("invitations").select("email_token, sent_at, delivered_at, expires_at").eq("id", invitationId).maybeSingle()).data
      : null;
  const sent = await sendInvitation(invitationId);
  if (sent === true) return true;
  if (sent === false) {
    if (was === "sent") {
      if (before) {
        const { error } = await admin.from("invitations").update(before).eq("id", invitationId).is("accepted_at", null);
        if (error) console.error("Putting back a sent invitation after a failed resend failed", error.message);
      }
    } else {
      const supabase = await createClient();
      await supabase.rpc("copy_invitation_not_sent", { p_id: invitationId, p_was_expired: was === "expired" });
    }
    return "The email didn't go out. Check the address, then send it again.";
  }
  return sent;
}

export type RemoveState = ActionState & { undoId?: string };

/** Remove a copied Coordinator who hasn't been emailed (no confirm: Undo instead). */
export async function removeCopyCoordinator(eventId: string, invitationId: string): Promise<RemoveState> {
  await requireUser();
  const person = (await loadCopyCoordinators(eventId)).find((c) => c.invitation_id === invitationId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_copy_invitation", { p_id: invitationId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: `${person?.name ?? "They were"} removed.`, undoId: data as string };
}

export async function undoRemoveCopyCoordinator(eventId: string, removalId: string): Promise<ActionState> {
  await requireUser();
  if (!UUID.test(removalId)) return { error: "That can't be undone anymore." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_remove_copy_invitation", { p_removal: removalId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: "Put back." };
}

/** Change the email of a copied Coordinator who hasn't been emailed; "Save and send" sends it too. */
export async function fixCopyCoordinatorEmail(eventId: string, invitationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Please enter a valid email address.", fieldErrors: { email: "Please enter a valid email address." } };
  const supabase = await createClient();
  const was = (await loadCopyCoordinators(eventId)).find((c) => c.invitation_id === invitationId)?.status === "expired" ? "expired" : "held";
  const { error } = await supabase.rpc("fix_copy_invitation_email", { p_id: invitationId, p_email: email });
  if (error) return { error: friendlyDbError(error), fieldErrors: { email: friendlyDbError(error) } };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (formData.get("send") !== "1") return { ok: true, message: `Saved ${email}.` };
  const sent = await sendCopyInvitation(invitationId, was);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return sent === true ? { ok: true, message: `Saved, and the invitation went to ${email}.` } : { error: `Saved ${email}, but ${lowerFirst(sent)}` };
}

/**
 * Delete and start over: deletes the copy (only for whoever made it, never published, nothing on it), its stored
 * files, and any invitation it sent; then back to Duplicate event with the name and first day kept.
 */
export async function discardCopy(eventId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discard_event_copy", { p_event: eventId });
  if (error) return { error: friendlyDbError(error) };
  const gone = data as { paths: string[]; source_event_id: string | null; name: string; starts_on: string };
  if (gone.paths?.length) {
    const { error: removeError } = await createAdminClient().storage.from(FILES_BUCKET).remove(gone.paths);
    if (removeError) console.error("Removing a discarded copy's files from storage failed", removeError);
  }
  revalidatePath("/dashboard", "layout");
  // Back to Duplicate event with the name and day kept; its back link goes to My events (the copy is gone).
  const keep = new URLSearchParams({ name: gone.name, on: gone.starts_on, from: "events" }).toString();
  return {
    ok: true,
    message: `Deleted ${gone.name}.`,
    goTo: gone.source_event_id ? `/dashboard/events/${gone.source_event_id}/duplicate?${keep}` : "/dashboard",
  };
}

export type PublishCopyState = ActionState & {
  /** Emailed an invitation just now. */
  emailed?: { name: string; email: string }[];
  /** Ticked but not emailed, and why (they stay "Not emailed yet" to send later). */
  notEmailed?: { invitationId: string; name: string; email: string; why: string }[];
};

/**
 * Publish the copy, then email the Coordinators ticked in the publish window. Publishes as the signed-in person
 * (the plan checks run); if publishing fails, nobody is emailed. Only invitations not emailed yet, or expired, are
 * sent, so unpublishing and publishing again never emails anyone twice. `signup`: a volunteer event or fair opens
 * sign-up now or later; a contest or festival leaves it out (registration opens on its date).
 */
export async function publishCopy(eventId: string, send: string[], signup?: "now" | "later"): Promise<PublishCopyState> {
  await requireUser();
  const supabase = await createClient();
  const { data: ev } = await supabase.from("events").select("event_type, name, timezone, band_registration_opens_on").eq("id", eventId).maybeSingle();
  if (!ev) return { error: "Only the event's host can publish it." };
  const signsUp = ev.event_type === "volunteer" || ev.event_type === "fair";
  const registers = ev.event_type === "band_contest" || ev.event_type === "group_event";
  // A contest or festival opens registration as it publishes (on its opening day, if one is set), as its own
  // publish button does; everything else publishes with sign-up open now or later.
  const published = registers
    ? await publishAndOpenBandRegistration(eventId, true)
    : await changePublished(eventId, true, signsUp && signup ? signup === "now" : undefined, true);
  if (published.error) {
    // Read the event's state before choosing the words: it may have published even though a step after failed.
    const { data: now } = await supabase.from("events").select("status").eq("id", eventId).maybeSingle();
    if (now?.status !== "published") return { error: published.error };
    revalidatePath(`/dashboard/events/${eventId}`, "layout");
    return { ok: true, message: `Published, but ${lowerFirst(published.error)} Nobody was emailed yet: send invitations from Team setup.` };
  }

  const people = await loadCopyCoordinators(eventId);
  const ticked = people.filter((p) => send.includes(p.invitation_id) && (p.status === "held" || p.status === "expired"));
  const emailed: { name: string; email: string }[] = [];
  const notEmailed: { invitationId: string; name: string; email: string; why: string }[] = [];
  // After publishing, in small batches (each takes a team spot as it's sent; a full team stops the rest with the
  // reason). The page allows enough time for a long list (maxDuration on the event page).
  for (let i = 0; i < ticked.length; i += 3) {
    const batch = ticked.slice(i, i + 3);
    const results = await Promise.all(batch.map((p) => sendCopyInvitation(p.invitation_id, p.status === "expired" ? "expired" : "held")));
    results.forEach((sent, j) => {
      const p = batch[j];
      if (sent === true) emailed.push({ name: p.name, email: p.email });
      else notEmailed.push({ invitationId: p.invitation_id, name: p.name, email: p.email, why: sent });
    });
  }
  // Everyone else still not emailed: unticked in the window, or couldn't be sent now. The message names them too.
  const left = people.filter((p) => (p.status === "held" || p.status === "expired") && !ticked.includes(p));
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard", "layout");

  const opensLater = ev.band_registration_opens_on && ev.band_registration_opens_on > utcToZonedDate(new Date().toISOString(), ev.timezone || "America/Chicago");
  const head = registers
    ? opensLater
      ? `Published. Registration opens ${formatDate(ev.band_registration_opens_on, { year: undefined })}`
      : "Published, and registration is open"
    : signsUp && signup
      ? signup === "later"
        ? "Published. Sign-up is closed until you open it"
        : "Published, and sign-up is open"
      : "Published";
  // Only what happened to the event: the amber card below Links to share names anyone not emailed, with the buttons to
  // send or remove (one place for it, not two).
  return {
    ok: true,
    message: `${head}.`,
    emailed,
    notEmailed: [...notEmailed, ...left.map((p) => ({ invitationId: p.invitation_id, name: p.name, email: p.email, why: "Not ticked when publishing" }))],
  };
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
