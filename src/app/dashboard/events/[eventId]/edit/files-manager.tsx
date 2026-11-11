"use client";

import { useState, useTransition } from "react";
import { Button, Field, FormMessage, Input } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { uploadToSignedUrl } from "@/lib/signed-upload";
import type { UploadedFile } from "../../../file-actions";
import { confirmDialog } from "@/components/confirm-dialog";
import { DateField } from "@/components/date-field";

const TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX = 10 * 1024 * 1024;

export type ManagedFile = {
  id: string;
  label: string;
  meta: string;
  audiences: string[];
  visibleFrom: string | null;
  /** "Hidden until Tue, Oct 20" while its day hasn't come. */
  hiddenNote: string | null;
  href: string;
  /** "Uploaded by Hana Host · Tue, Oct 7, 9:52 AM CDT" */
  uploaded: string | null;
};

type Audience = { value: string; label: string; hint: string };

/** Maps and documents on Edit details: add, change, replace and remove files. */
export function FilesManager({
  files,
  audiences,
  prepareUpload,
  saveFile,
  deleteFile,
  canNotify = false,
}: {
  files: ManagedFile[];
  /** Offer to email people about a file (band contests only). */
  canNotify?: boolean;
  audiences: readonly Audience[];
  prepareUpload: (file: { fileName: string; contentType: string; size: number }) => Promise<{ error?: string; path?: string; url?: string }>;
  saveFile: (fileId: string | null, uploaded: UploadedFile | null, prev: ActionState, formData: FormData) => Promise<ActionState>;
  deleteFile: (fileId: string) => Promise<ActionState>;
}) {
  const [editing, setEditing] = useState<string | null>(files.length === 0 ? "new" : null);
  const [message, setMessage] = useState<string | null>(null);
  const label = (v: string) => audiences.find((a) => a.value === v)?.label ?? v;

  return (
    <div className="space-y-3">
      {message && <FormMessage success={message} />}
      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {files.map((f) =>
            editing === f.id ? (
              <li key={f.id} className="p-3">
                <FileForm
                  canNotify={canNotify}
                  file={f}
                  audiences={audiences}
                  prepareUpload={prepareUpload}
                  saveFile={saveFile}
                  onDone={(msg) => {
                    setEditing(null);
                    setMessage(msg);
                  }}
                />
              </li>
            ) : (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <a href={f.href} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
                    {f.label}
                  </a>
                  <p className="text-sm text-muted">
                    {[f.meta, f.audiences.map(label).join(", "), f.hiddenNote].filter(Boolean).join(" · ")}
                  </p>
                  {f.uploaded && <p className="text-xs text-muted">{f.uploaded}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setEditing(f.id)}>
                    Edit
                  </Button>
                  <RemoveFile label={f.label} onRemove={() => deleteFile(f.id)} />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" ? (
        <div className="rounded-lg border border-border p-3">
          <FileForm
                  canNotify={canNotify}
            audiences={audiences}
            prepareUpload={prepareUpload}
            saveFile={saveFile}
            onDone={(msg) => {
              setEditing(null);
              setMessage(msg);
            }}
            onCancel={files.length ? () => setEditing(null) : undefined}
          />
        </div>
      ) : (
        <Button type="button" variant="secondary" className="min-h-10" onClick={() => setEditing("new")}>
          + Add a file
        </Button>
      )}
    </div>
  );
}

function RemoveFile({ label, onRemove }: { label: string; onRemove: () => Promise<ActionState> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="min-h-9 px-2 text-xs"
        disabled={pending}
        onClick={async () => {
          const ok = await confirmDialog({
            title: `Remove “${label}”?`,
            message: "Anyone with the link won't be able to open it anymore.",
            confirmLabel: "Remove file",
            danger: true,
          });
          if (!ok) return;
          start(async () => {
            const r = await onRemove();
            if (r.error) setError(r.error);
          });
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </>
  );
}

function FileForm({
  file,
  audiences,
  prepareUpload,
  saveFile,
  onDone,
  onCancel,
  canNotify,
}: {
  canNotify: boolean;
  file?: ManagedFile;
  audiences: readonly Audience[];
  prepareUpload: (file: { fileName: string; contentType: string; size: number }) => Promise<{ error?: string; path?: string; url?: string }>;
  saveFile: (fileId: string | null, uploaded: UploadedFile | null, prev: ActionState, formData: FormData) => Promise<ActionState>;
  onDone: (message: string | null) => void;
  onCancel?: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(file?.audiences ?? ["public"]);
  const [hide, setHide] = useState(Boolean(file?.visibleFrom));
  const [label, setLabel] = useState(file?.label ?? "");
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const toDirectors = chosen.includes("directors") || chosen.includes("public");
  const toVolunteers = chosen.includes("volunteers") || chosen.includes("public");

  /** True once it's saved. */
  async function submit(form: HTMLFormElement): Promise<boolean> {
    const fail = (message: string) => {
      setError(message);
      return false;
    };
    setError(null);
    const data = new FormData(form);
    const picked = data.get("file");
    const upload = picked instanceof File && picked.size > 0 ? picked : null;
    if (!file && !upload) return fail("Please choose a file to upload.");
    let uploaded: UploadedFile | null = null;
    if (upload) {
      if (!TYPES.includes(upload.type)) return fail("Please choose a PDF, JPG, or PNG file.");
      if (upload.size > MAX) return fail("That file is over 10 MB. Try a smaller PDF or a photo.");
      setStep("Uploading…");
      const ticket = await prepareUpload({ fileName: upload.name, contentType: upload.type, size: upload.size });
      if (ticket.error || !ticket.path || !ticket.url) {
        setStep(null);
        return fail(ticket.error ?? "We couldn't start the upload. Please try again.");
      }
      if (!(await uploadToSignedUrl(ticket.url, upload))) {
        setStep(null);
        return fail("The upload didn't go through. Check your connection and try again.");
      }
      uploaded = { path: ticket.path, fileName: upload.name, contentType: upload.type, size: upload.size };
    }
    setStep("Saving…");
    // The file itself already went straight to storage: send only its details
    // (a big PDF here would go over the server's 1 MB limit for a save).
    data.delete("file");
    if (!hide) data.set("visibleFrom", "");
    const result = await saveFile(file?.id ?? null, uploaded, {}, data);
    setStep(null);
    if (result.error) return fail(result.error);
    onDone(result.message ?? null);
    return true;
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        // Tells whoever's waiting on this save how it went (the guided setup's Skip for now).
        const tell = (saved: boolean) => form.dispatchEvent(new Event(saved ? "form-saved" : "form-failed", { bubbles: true }));
        void submit(form)
          .then(tell)
          .catch((err) => {
            tell(false);
            console.error("File upload failed", err);
            setStep(null);
            setError("Something went wrong. Please reload the page and try again.");
          });
      }}
    >
      <p className="text-sm font-semibold">{file ? `Edit “${file.label}”` : "Add a map or document"}</p>
      <Field label={file ? "Replace the file (optional)" : "File"} hint="PDF, JPG, or PNG, up to 10 MB.">
        <input
          type="file"
          name="file"
          accept="application/pdf,image/jpeg,image/png"
          required={!file}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
          }}
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm file:font-medium"
        />
      </Field>
      <Field label="Name" hint="What people will see, e.g. Stadium & parking map.">
        <Input name="label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">Who can see it?</legend>
        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {audiences.map((a) => (
            <label key={a.value} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:border-brand">
              <input
                type="checkbox"
                name="audiences"
                value={a.value}
                checked={chosen.includes(a.value)}
                onChange={(e) => setChosen((prev) => (e.target.checked ? [...prev, a.value] : prev.filter((x) => x !== a.value)))}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="font-medium">{a.label}</span>
                <span className="block text-xs text-muted">{a.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
          Keep it hidden until a date
        </label>
        {hide && (
          <Field label="Show it starting" hint="Until then, only hosts can see it." className="mt-2 max-w-xs">
            <DateField name="visibleFrom" required defaultValue={file?.visibleFrom ?? ""} />
          </Field>
        )}
      </div>
      {canNotify && hide && (toDirectors || toVolunteers) && (
        <p className="text-xs text-muted">To email people about it, edit it again once it&apos;s showing.</p>
      )}
      {canNotify && !hide && (toDirectors || toVolunteers) && (
        <fieldset className="rounded-lg bg-background px-3 py-2">
          <legend className="sr-only">Email people about it</legend>
          <p className="text-sm font-medium">Let people know?</p>
          {toDirectors && (
            <label className="mt-1 flex items-center gap-3 text-sm">
              <input type="checkbox" name="notifyDirectors" className="h-5 w-5 accent-[var(--brand)]" />
              Email band directors
            </label>
          )}
          {toVolunteers && (
            <label className="mt-1 flex items-center gap-3 text-sm">
              <input type="checkbox" name="notifyVolunteers" className="h-5 w-5 accent-[var(--brand)]" />
              Email volunteers
            </label>
          )}
        </fieldset>
      )}
      <FormMessage error={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={Boolean(step)} aria-busy={Boolean(step)}>
          {step ?? (file ? "Save changes" : "Add file")}
        </Button>
        {(file || onCancel) && (
          <Button type="button" variant="ghost" onClick={() => (onCancel ? onCancel() : onDone(null))}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
