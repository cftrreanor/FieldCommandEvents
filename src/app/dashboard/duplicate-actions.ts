"use server";

import { revalidatePath } from "next/cache";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { copyCopiedFiles, loadCopyCoordinators, type CopiedFile, type DuplicateResult } from "@/lib/duplicate-event";
import { FILES_BUCKET } from "@/lib/event-files";
import { changePublished } from "@/lib/publish-event";
import { sendInvitation } from "@/lib/send-invitation";
import { createAdminClient, createClient } from "@/lib/supabase/server";

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fieldErrors.startsOn = "Pick the new first day";
  if (Object.keys(fieldErrors).length) {
    const n = Object.keys(fieldErrors).length;
    return { error: n === 1 ? `${Object.values(fieldErrors)[0]}, outlined in red above.` : `Fix the ${n} answers outlined in red above.`, fieldErrors };
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
  const { failed } = await copyCopiedFiles(result.event_id, result.summary.files ?? []);

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

/** A copied step was opened ("Opened"), or saved or confirmed (it stops asking to be checked). */
export async function markCopyStep(eventId: string, step: string, confirmed = false): Promise<ActionState> {
  await requireUser();
  if (!UUID.test(eventId) || !STEPS.includes(step as (typeof STEPS)[number])) return { error: "That step isn't on this event." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_copy_step", { p_event: eventId, p_step: step, p_confirmed: confirmed });
  if (error) return { error: friendlyDbError(error) };
  if (confirmed) revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

/** Send now: email one copied Coordinator their invitation before publishing (the window confirms first). */
export async function sendCopyInvitationNow(eventId: string, invitationId: string): Promise<ActionState> {
  await requireUser();
  const person = (await loadCopyCoordinators(eventId)).find((c) => c.invitation_id === invitationId);
  if (!person) return { error: "That invitation isn't on this event anymore. Refresh to see the team." };
  if (person.status === "accepted") return { error: `${person.name} has already accepted.` };
  if (person.status === "sent") return { error: `${person.name}'s invitation was already sent. Use Resend.` };
  const sent = await sendCopyInvitation(invitationId);
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (sent !== true) return { error: sent };
  return { ok: true, message: `Invitation sent to ${person.name}.` };
}

/**
 * Sends one copied invitation. If the email didn't go out, it goes back to "Not emailed yet" (nobody holds a link
 * that was never delivered). Returns true, or why it wasn't sent.
 */
async function sendCopyInvitation(invitationId: string): Promise<true | string> {
  const sent = await sendInvitation(invitationId);
  if (sent === true) return true;
  if (sent === false) {
    const supabase = await createClient();
    await supabase.rpc("copy_invitation_not_sent", { p_id: invitationId });
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
  const who = person?.name ?? "them";
  const job = person?.jobs.length ? ` from ${person.jobs.join(" and ")}` : "";
  return { ok: true, message: `Removed ${who}${job}.`, undoId: data as string };
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

/** Fix the address of a copied Coordinator who hasn't been emailed; "Save and send" sends it too. */
export async function fixCopyCoordinatorEmail(eventId: string, invitationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Please enter a valid email address.", fieldErrors: { email: "Please enter a valid email address." } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("fix_copy_invitation_email", { p_id: invitationId, p_email: email });
  if (error) return { error: friendlyDbError(error), fieldErrors: { email: friendlyDbError(error) } };
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  if (formData.get("send") !== "1") return { ok: true, message: `Saved ${email}.` };
  const sent = await sendCopyInvitation(invitationId);
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
  const keep = new URLSearchParams({ name: gone.name, on: gone.starts_on }).toString();
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
  const { data: ev } = await supabase.from("events").select("event_type, name").eq("id", eventId).maybeSingle();
  if (!ev) return { error: "Only the event's host can publish it." };
  const signsUp = ev.event_type === "volunteer" || ev.event_type === "fair";
  const published = await changePublished(eventId, true, signsUp && signup ? signup === "now" : undefined);
  if (published.error) return { error: published.error };

  const people = await loadCopyCoordinators(eventId);
  const ticked = people.filter((p) => send.includes(p.invitation_id) && (p.status === "held" || p.status === "expired"));
  const emailed: { name: string; email: string }[] = [];
  const notEmailed: { invitationId: string; name: string; email: string; why: string }[] = [];
  // One at a time: each takes a team spot as it's sent, and a full team stops the rest with the reason.
  for (const p of ticked) {
    const sent = await sendCopyInvitation(p.invitation_id);
    if (sent === true) emailed.push({ name: p.name, email: p.email });
    else notEmailed.push({ invitationId: p.invitation_id, name: p.name, email: p.email, why: sent });
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard", "layout");

  const head = signsUp ? (signup === "later" ? "Published. Sign-up is closed until you open it" : "Published, and sign-up is open") : "Published";
  const names = (list: { name: string }[]) => joinNames(list.map((p) => p.name));
  const parts = [
    emailed.length ? `Invitations went to ${names(emailed)}.` : "",
    notEmailed.length ? `${names(notEmailed)} ${notEmailed.length === 1 ? "wasn't" : "weren't"} emailed.` : "",
  ].filter(Boolean);
  return { ok: true, message: [`${head}.`, ...parts].join(" "), emailed, notEmailed };
}

/** "a, b, and c" */
function joinNames(items: string[]) {
  return items.length > 2 ? `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}` : items.join(" and ");
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
