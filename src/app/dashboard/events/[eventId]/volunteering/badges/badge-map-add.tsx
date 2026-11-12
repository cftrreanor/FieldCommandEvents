"use client";

import { useId, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, FormMessage, Input } from "@/components/ui";
import { confirmDialog } from "@/components/confirm-dialog";
import { uploadToSignedUrl } from "@/lib/signed-upload";
import { addBadgeMap, deleteFile, prepareBadgeMapUpload } from "../../../../file-actions";

const TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX = 10 * 1024 * 1024;

/**
 * Add a map for the badges' back, right here (hosts and Volunteer Leads). It's saved to the event's Maps and
 * documents for volunteers and the team, and picked for the back. Sits inside the page's choices form, so it uses
 * no form of its own and its fields have no names.
 */
export function BadgeMapAdd({ eventId, removable }: { eventId: string; removable: { id: string; label: string } | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();

  const pick = (back: string) => {
    const next = new URLSearchParams(params.toString());
    if (back) next.set("back", back);
    else next.delete("back");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    router.refresh();
  };

  async function add() {
    setError(null);
    if (!file) return setError("Please choose a file to upload.");
    if (!TYPES.includes(file.type)) return setError("Please choose a PDF, JPG, or PNG file.");
    if (file.size > MAX) return setError("That file is over 10 MB. Try a smaller PDF or a photo.");
    if (!label.trim()) return setError("Please give the map a name, like “Parking and entrances”.");
    try {
      setStep("Uploading…");
      const ticket = await prepareBadgeMapUpload(eventId, { fileName: file.name, contentType: file.type, size: file.size });
      if (ticket.error || !ticket.path || !ticket.url) throw new Error(ticket.error ?? "We couldn't start the upload. Please try again.");
      if (!(await uploadToSignedUrl(ticket.url, file))) throw new Error("The upload didn't go through. Check your connection and try again.");
      setStep("Saving…");
      const saved = await addBadgeMap(eventId, { path: ticket.path, fileName: file.name, contentType: file.type, size: file.size }, label);
      if (saved.error || !saved.id) throw new Error(saved.error ?? "We couldn't save the map. Please try again.");
      setOpen(false);
      setFile(null);
      setLabel("");
      pick(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setStep(null);
    }
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" className="min-h-10" onClick={() => setOpen(true)}>
          Add a map
        </Button>
        {removable && (
          <Button
            type="button"
            variant="ghost"
            className="min-h-10"
            disabled={removing}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Remove “${removable.label}”?`,
                message: "It comes off the badges and out of the event's documents. Volunteers and the team won't be able to open it anymore.",
                confirmLabel: "Remove map",
                danger: true,
              });
              if (!ok) return;
              startRemove(async () => {
                const r = await deleteFile(eventId, removable.id);
                if (r.error) setError(r.error);
                else pick("");
              });
            }}
          >
            {removing ? "Removing…" : `Remove “${removable.label}”`}
          </Button>
        )}
        <FormMessage error={error} />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border p-3 font-normal">
      <p className="text-sm font-semibold">Add a map</p>
      <div>
        <label htmlFor={`${ids}-file`} className="text-sm font-medium">
          File
        </label>
        <input
          id={`${ids}-file`}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          aria-describedby={`${ids}-file-hint`}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
          }}
          className="mt-1 block w-full text-sm file:mr-3 file:min-h-10 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-sm file:font-medium"
        />
        <p id={`${ids}-file-hint`} className="mt-1 text-xs text-muted">
          PDF, JPG, or PNG, up to 10 MB. A PDF prints its first page.
        </p>
      </div>
      <div>
        <label htmlFor={`${ids}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${ids}-name`}
          value={label}
          maxLength={120}
          placeholder="For example, Parking and entrances"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the map, not the page's "Update preview".
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          className="mt-1"
        />
      </div>
      <p className="text-xs text-muted">Volunteers and the team can open it too, with the event&apos;s other maps and documents.</p>
      <FormMessage error={error} />
      <div className="flex gap-2">
        <Button type="button" disabled={Boolean(step)} aria-busy={Boolean(step)} onClick={() => void add()}>
          {step ?? "Add map"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={Boolean(step)}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
