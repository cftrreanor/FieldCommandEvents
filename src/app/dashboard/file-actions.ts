"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { friendlyDbError, type ActionState } from "@/lib/action-state";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { emailLayout, pause, sendEmail } from "@/lib/email";
import { AUDIENCES, FILE_TYPES, FILES_BUCKET, fileHref, MAX_FILE_BYTES } from "@/lib/event-files";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { customWords, loadSystemEmail } from "@/lib/system-email-overrides";
import { formatDate } from "@/lib/time";
import { manageUrl } from "@/lib/volunteer-emails";

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(FILE_TYPES),
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
});

async function isHost(eventId: string) {
  const supabase = await createClient();
  return Boolean((await supabase.rpc("is_event_admin", { ev: eventId })).data);
}

/**
 * Step 1 of adding or replacing a file: a one-time upload link. The browser
 * sends the file straight to storage (big PDFs don't fit through our server).
 */
export async function prepareUpload(
  eventId: string,
  file: { fileName: string; contentType: string; size: number },
): Promise<{ error?: string; path?: string; url?: string }> {
  await requireUser();
  const parsed = uploadSchema.safeParse(file);
  if (!parsed.success) {
    return {
      error:
        file.size > MAX_FILE_BYTES
          ? "That file is over 10 MB. Try a smaller PDF or a photo."
          : "Please choose a PDF, JPG, or PNG file.",
    };
  }
  if (!(await isHost(eventId))) return { error: "Only hosts can add files." };
  return signedUpload(eventId, parsed.data.fileName);
}

/** A one-time upload link for a file in this event's folder (the caller checked who may add it). */
async function signedUpload(eventId: string, fileName: string): Promise<{ error?: string; path?: string; url?: string }> {
  const safeName = fileName.replace(/[^\w.-]+/g, "-").slice(-80);
  const path = `${eventId}/${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await createAdminClient().storage.from(FILES_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("createSignedUploadUrl failed", error);
    return { error: "We couldn't start the upload. Please try again." };
  }
  return { path, url: data.signedUrl };
}

/** Volunteer badges: hosts and Volunteer Leads add a map for the back, seen by volunteers and the team only. */
export async function prepareBadgeMapUpload(
  eventId: string,
  file: { fileName: string; contentType: string; size: number },
): Promise<{ error?: string; path?: string; url?: string }> {
  await requireUser();
  const parsed = uploadSchema.safeParse(file);
  if (!parsed.success) {
    return { error: file.size > MAX_FILE_BYTES ? "That file is over 10 MB. Try a smaller PDF or a photo." : "Please choose a PDF, JPG, or PNG file." };
  }
  const supabase = await createClient();
  if (!(await supabase.rpc("can_manage_volunteers", { ev: eventId })).data) return { error: "You don't have permission to do that." };
  return signedUpload(eventId, parsed.data.fileName);
}

/** Saves a badge map uploaded with prepareBadgeMapUpload. The database allows it only for volunteers and the team. */
export async function addBadgeMap(eventId: string, uploaded: UploadedFile, label: string): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const name = label.trim();
  if (!name) return { error: "Please give the map a name, like “Parking and entrances”." };
  if (name.length > 120) return { error: "Please use a shorter name (up to 120 characters)." };
  const ok = uploadSchema.safeParse({ fileName: uploaded.fileName, contentType: uploaded.contentType, size: uploaded.size });
  const ourPath = new RegExp(`^${eventId}/[0-9a-f-]{36}-[\\w.-]{1,80}$`).test(uploaded.path);
  if (!ok.success || !ourPath) return { error: "Something went wrong with the upload. Please try again." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_files")
    .insert({
      event_id: eventId,
      created_by: user.id,
      label: name,
      audiences: ["volunteers", "team"],
      path: uploaded.path,
      file_name: uploaded.fileName,
      content_type: uploaded.contentType,
      size_bytes: uploaded.size,
    })
    .select("id")
    .single();
  if (error || !data) {
    await createAdminClient().storage.from(FILES_BUCKET).remove([uploaded.path]);
    return { error: error ? friendlyDbError(error) : "We couldn't save the map. Please try again." };
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { id: data.id };
}

const detailsSchema = z.object({
  label: z.string().trim().min(1, "Please give the file a name, like “Stadium & parking map”.").max(120),
  audiences: z.array(z.enum(AUDIENCES.map((a) => a.value) as [string, ...string[]])).min(1, "Choose who can see it."),
  visibleFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
});

export type UploadedFile = { path: string; fileName: string; contentType: string; size: number };

/** Step 2: save the file's details (and the uploaded file, if there's a new one). */
export async function saveFile(
  eventId: string,
  fileId: string | null,
  uploaded: UploadedFile | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = detailsSchema.safeParse({
    label: formData.get("label"),
    audiences: formData.getAll("audiences").map(String),
    visibleFrom: String(formData.get("visibleFrom") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (!fileId && !uploaded) return { error: "Please choose a file to upload." };
  // Only the event's hosts, and only for that event's own files: the heads-up
  // emails below go to the event's directors and volunteers.
  if (!(await isHost(eventId))) return { error: "You don't have permission to do that." };
  if (uploaded) {
    const ok = uploadSchema.safeParse({ fileName: uploaded.fileName, contentType: uploaded.contentType, size: uploaded.size });
    // Exactly the shape prepareUpload made: this event's folder, a random id, a cleaned name.
    const ourPath = new RegExp(`^${eventId}/[0-9a-f-]{36}-[\\w.-]{1,80}$`).test(uploaded.path);
    if (!ok.success || !ourPath) return { error: "Something went wrong with the upload. Please try again." };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const fileFields = uploaded
    ? { path: uploaded.path, file_name: uploaded.fileName, content_type: uploaded.contentType, size_bytes: uploaded.size }
    : {};
  const fields = { label: v.label, audiences: v.audiences, visible_from: v.visibleFrom || null, ...fileFields };

  let savedId = fileId;
  if (fileId) {
    const { data: before } = await supabase.from("event_files").select("path, event_id").eq("id", fileId).maybeSingle();
    if (!before || before.event_id !== eventId) return { error: "You don't have permission to do that." };
    const { error } = await supabase
      .from("event_files")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", fileId);
    if (error) return { error: friendlyDbError(error) };
    // Replaced: the old copy goes.
    if (uploaded && before.path !== uploaded.path) await admin.storage.from(FILES_BUCKET).remove([before.path]);
  } else {
    const { data, error } = await supabase
      .from("event_files")
      .insert({ event_id: eventId, created_by: user.id, ...fields })
      .select("id")
      .single();
    if (error) {
      await admin.storage.from(FILES_BUCKET).remove([uploaded!.path]);
      return { error: friendlyDbError(error) };
    }
    savedId = data.id;
  }

  // Optional heads-up emails, sent after the page responds.
  const notifyDirectors = formData.get("notifyDirectors") === "on" && v.audiences.some((a) => a === "directors" || a === "public");
  const notifyVolunteers = formData.get("notifyVolunteers") === "on" && v.audiences.some((a) => a === "volunteers" || a === "public");
  if ((notifyDirectors || notifyVolunteers) && savedId) {
    const origin = await getOrigin();
    const id = savedId;
    after(() => notify(eventId, id, v.label, Boolean(fileId), { directors: notifyDirectors, volunteers: notifyVolunteers }, origin));
  }

  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  const told = [notifyDirectors && "directors", notifyVolunteers && "volunteers"].filter(Boolean).join(" and ");
  return { ok: true, message: `Saved${told ? `. We're emailing ${told} now` : ""}.` };
}

export async function deleteFile(eventId: string, fileId: string): Promise<ActionState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_files").delete().eq("id", fileId).select("path");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You don't have permission to do that." };
  await createAdminClient().storage.from(FILES_BUCKET).remove(data.map((d) => d.path));
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true };
}

async function notify(
  eventId: string,
  fileId: string,
  label: string,
  replaced: boolean,
  who: { directors: boolean; volunteers: boolean },
  origin: string,
) {
  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("name, starts_on").eq("id", eventId).single();
  if (!event) return;
  const heading = `${replaced ? "Updated" : "New"}: ${label}`;
  const intro = `${replaced ? "An updated" : "A new"} file was shared for ${event.name} (${formatDate(event.starts_on)}).`;
  // An admin's wording (/admin/emails), if they saved one.
  const vars = {
    file_name: label,
    change: replaced ? "updated" : "new",
    a_change: replaced ? "an updated" : "a new",
    event_name: event.name,
    event_date: formatDate(event.starts_on),
  };
  const [forDirectors, forVolunteers] = await Promise.all([
    who.directors ? loadSystemEmail("director_file_shared") : null,
    who.volunteers ? loadSystemEmail("volunteer_file_shared") : null,
  ]);
  const director = customWords("director_file_shared", forDirectors, vars);
  const volunteer = customWords("volunteer_file_shared", forVolunteers, vars);

  if (who.directors) {
    // The accounts that registered the bands: they're the ones who can sign in and open it.
    const { data: bands } = await admin.from("bands").select("director_user_id").eq("event_id", eventId);
    const ids = [...new Set((bands ?? []).map((b) => b.director_user_id).filter(Boolean))];
    const { data: people } = ids.length ? await admin.from("profiles").select("email").in("id", ids) : { data: [] };
    const emails = [...new Set((people ?? []).map((p) => p.email as string).filter(Boolean))];
    for (const to of emails) {
      const { html, text } = emailLayout({
        heading: director?.heading || heading,
        paragraphs: director?.paragraphs ?? [intro, "Sign in with the email you registered your band with to open it."],
        button: { label: director?.button || `Open ${label}`, url: `${origin}${fileHref(fileId)}` },
      });
      await sendEmail({ to, subject: director?.subject || `${heading} · ${event.name}`, html, text, eventId });
      await pause();
    }
  }
  if (who.volunteers) {
    const { data: vols } = await admin
      .from("volunteers")
      .select("email, access_token")
      .eq("event_id", eventId)
      .not("email", "is", null);
    for (const v of vols ?? []) {
      const { html, text } = emailLayout({
        heading: volunteer?.heading || heading,
        paragraphs: volunteer?.paragraphs ?? [intro, "It's on your shifts page, along with your times."],
        button: { label: volunteer?.button || "View my shifts", url: manageUrl(origin, v) },
      });
      await sendEmail({ to: v.email!, subject: volunteer?.subject || `${heading} · ${event.name}`, html, text, eventId });
      await pause();
    }
  }
}
