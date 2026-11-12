"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { ActionForm } from "@/components/action-form";
import { confirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toaster";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { ArrivedButton } from "./arrived-button";

export type BoothValues = {
  title: string;
  host_name: string | null;
  zone: string | null;
  location: string | null;
  description: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  show_publicly: boolean;
};

/** A booth as the zone's list shows it: its phone already formatted, and when it arrived (if it has). */
export type BoothRow = BoothValues & { id: string; phone: string | null; arrived: boolean; arrivedTime: string | null };

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Add or edit a booth: what it is, who hosts it, its zone and spot, and a
 * private contact. Like a sign-up in Volunteer Setup, its buttons sit in a
 * footer pinned to the bottom of the screen until the form ends.
 */
export function BoothEditor({
  action,
  initial,
  zones,
  zone,
  onDone,
  remove,
}: {
  action: FormAction;
  initial?: BoothValues;
  zones: string[];
  /** The zone it's in, or the open tab's for a new booth. */
  zone: string | null;
  onDone: () => void;
  /** Editing: delete the booth. */
  remove?: () => Promise<ActionState>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [dirty, setDirty] = useState(false);
  const [deleting, startDelete] = useTransition();
  const isNew = !initial;
  // A booth from before zones were required may have none (or one since deleted): ask for one.
  const list = zone && !zones.includes(zone) ? [...zones, zone] : zones;
  return (
    <ActionForm
      action={action}
      resetOnSuccess={false}
      onSuccess={onDone}
      onEdit={(form) => {
        setDirty(true);
        setTitle((form.elements.namedItem("title") as HTMLInputElement | null)?.value ?? "");
      }}
      className="rounded-lg border border-border bg-background shadow-card"
    >
      <div className="space-y-4 px-4 pt-4 sm:px-6">
        <h4 className="text-lg font-semibold">{isNew ? "Add a booth" : `Edit “${initial.title}”`}</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What it is" hint="e.g. Dunk Tank, Face Painting, Baked Goods">
            <Input name="title" required maxLength={120} defaultValue={initial?.title} autoFocus={isNew} />
          </Field>
          <Field label="Hosted by" hint="Optional. The partner, vendor, or group running it, for example Brightwater Wireless">
            <Input name="hostName" maxLength={120} defaultValue={initial?.host_name ?? ""} />
          </Field>
          <Field label="Zone" hint="Move it to another zone anytime.">
            <Select name="zone" required defaultValue={zone ?? ""}>
              {!zone && (
                <option value="" disabled>
                  Pick a zone
                </option>
              )}
              {list.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Where" hint="Optional. e.g. Booth 4, by the gym doors">
            <Input name="location" maxLength={120} defaultValue={initial?.location ?? ""} />
          </Field>
          <Field label="Description" hint="Optional. One line for the public page, e.g. 3D-printed keychains and toys" className="sm:col-span-2">
            <Textarea name="description" maxLength={500} rows={2} defaultValue={initial?.description ?? ""} />
          </Field>
        </div>
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">Contact (only your team sees this)</legend>
          <Field label="Name">
            <Input name="contactName" maxLength={120} defaultValue={initial?.contact_name ?? ""} />
          </Field>
          <Field label="Email">
            <Input name="contactEmail" type="email" maxLength={254} defaultValue={initial?.contact_email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="contactPhone" type="tel" inputMode="tel" maxLength={30} defaultValue={initial?.contact_phone ?? ""} />
          </Field>
        </fieldset>
        <label className="flex items-start gap-3 pb-4 text-sm">
          <input type="checkbox" name="showPublicly" defaultChecked={initial?.show_publicly ?? true} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
          <span>
            <span className="font-medium">Show on the public page</span>
            <span className="block text-muted">
              Listed under &ldquo;What&apos;s at the event&rdquo;, with a thank-you to whoever hosts it. Contact details are never shown.
            </span>
          </span>
        </label>
      </div>
      {/* The same footer as a sign-up in Volunteer Setup. */}
      <div className="sticky bottom-[var(--day-bar,0px)] z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-lg border-t-2 border-border bg-surface px-4 py-3 shadow-[0_-6px_16px_rgb(0_0_0/0.10)] sm:px-6">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm" aria-live="polite">
          {isNew && !title.trim() ? (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
              <span>
                <span className="font-semibold">What&apos;s left:</span> What it is
              </span>
            </>
          ) : dirty || isNew ? (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-[#f5b301] ring-1 ring-warning/50" />
              <span className="font-semibold">{isNew ? "Ready to add" : "Unsaved changes"}</span>
            </>
          ) : (
            <>
              <span aria-hidden className="font-bold text-success">
                ✓
              </span>
              <span className="font-semibold">No changes yet</span>
            </>
          )}
        </p>
        {remove && (
          <Button
            type="button"
            variant="danger"
            disabled={deleting}
            onClick={async () => {
              const ok = await confirmDialog({
                title: `Delete “${initial?.title}”?`,
                message: "It comes off this list and the public page. This can't be undone.",
                confirmLabel: "Delete booth",
                danger: true,
              });
              if (!ok) return;
              startDelete(async () => {
                const result = await remove();
                if (result.error) return toast(result.error);
                toast(`Deleted ${initial?.title}.`);
                onDone();
                router.refresh();
              });
            }}
          >
            {deleting ? "Deleting…" : "Delete booth"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…">{isNew ? "Add booth" : "Save booth"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/**
 * A zone's booths: one row each (Edit opens it in place), and "+ Add a
 * booth". One booth is open at a time. A zone with none starts with the form open.
 */
export function ZoneBooths({
  booths,
  zones,
  zone,
  save,
  remove,
  checkIn,
}: {
  booths: BoothRow[];
  zones: string[];
  /** The open tab's zone (null: the booths with none). */
  zone: string | null;
  save: (boothId: string | null, prev: ActionState, formData: FormData) => Promise<ActionState>;
  remove: (boothId: string) => Promise<ActionState>;
  /** From the day before the fair: tap partners in as they arrive. */
  checkIn?: (boothId: string, arrived: boolean) => Promise<ActionState>;
}) {
  const [open, setOpen] = useState<string | null>(booths.length === 0 && zone ? "new" : null);
  return (
    <div className="mt-4 space-y-4">
      {booths.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {booths.map((b) =>
            open === b.id ? (
              <li key={b.id} className="p-2 sm:p-3">
                <BoothEditor
                  action={save.bind(null, b.id)}
                  initial={b}
                  zones={zones}
                  zone={b.zone}
                  onDone={() => setOpen(null)}
                  remove={() => remove(b.id)}
                />
              </li>
            ) : (
              <li key={b.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {b.title}
                    {b.host_name && <span className="font-normal text-muted"> · {b.host_name}</span>}
                    {!b.show_publicly && (
                      <span className="ml-2 align-middle">
                        <Badge>Not on public page</Badge>
                      </span>
                    )}
                  </p>
                  {(b.location || b.description) && <p className="text-sm text-muted">{[b.location, b.description].filter(Boolean).join(" · ")}</p>}
                  {(b.contact_name || b.contact_email || b.phone) && (
                    <p className="text-sm text-muted">
                      {[b.contact_name, b.contact_email, b.phone].filter(Boolean).join(" · ")}
                      {b.contact_phone && (
                        <>
                          {" "}
                          <a href={`tel:${b.contact_phone}`} className="font-medium text-brand underline-offset-4 hover:underline">
                            Call
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {checkIn && b.host_name && <ArrivedButton arrived={b.arrived} time={b.arrivedTime} toggle={checkIn.bind(null, b.id)} />}
                  <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setOpen(b.id)} aria-label={`Edit ${b.title}`}>
                    Edit
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {open === "new" ? (
        <BoothEditor action={save.bind(null, null)} zones={zones} zone={zone} onDone={() => setOpen(null)} />
      ) : (
        zone && (
          <Button type="button" variant="secondary" onClick={() => setOpen("new")}>
            + Add a booth
          </Button>
        )
      )}
    </div>
  );
}

/** A zone's name with Rename and Delete zone. Deleting one with booths moves them to another zone, or deletes them too. */
export function ZoneHeader({
  name,
  booths,
  otherZones,
  rename,
  remove,
}: {
  name: string;
  booths: number;
  otherZones: string[];
  rename: FormAction;
  remove: (moveTo: string | null) => Promise<ActionState>;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [asking, setAsking] = useState(false);
  const [moveTo, setMoveTo] = useState<string>(otherZones[0] ?? "");
  const [deleteBooths, setDeleteBooths] = useState(otherZones.length === 0);
  const [pending, start] = useTransition();
  const go = (target: string | null) =>
    start(async () => {
      const result = await remove(target);
      setAsking(false);
      if (result.error) return toast(result.error);
      if (result.message) toast(result.message);
      router.push(result.goTo ?? "?", { scroll: false });
    });
  const plural = booths === 1 ? "booth" : "booths";
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{name}</h3>
          <p className="mt-1 text-sm text-muted">{booths ? `${booths} ${plural} · shown together on the public page` : "No booths yet"}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setRenaming(!renaming)} aria-expanded={renaming}>
            Rename
          </Button>
          <Button
            type="button"
            variant="danger"
            className="min-h-9 px-3 text-xs"
            disabled={pending}
            onClick={async () => {
              if (booths) return setAsking(true);
              if (await confirmDialog({ title: `Delete “${name}”?`, message: "It has no booths. You can add it again anytime.", confirmLabel: "Delete zone", danger: true }))
                go(null);
            }}
          >
            Delete zone
          </Button>
        </div>
      </div>
      {renaming && (
        <ActionForm
          action={rename}
          resetOnSuccess={false}
          onSuccess={() => setRenaming(false)}
          className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-end"
        >
          <Field label="Zone name" className="flex-1">
            <Input name="name" required maxLength={60} defaultValue={name} autoFocus />
          </Field>
          <div className="flex gap-2">
            <SubmitButton pendingText="Saving…">Save name</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      )}
      {asking &&
        createPortal(
          <dialog
            ref={(d) => {
              if (d && !d.open) d.showModal();
            }}
            onCancel={(e) => pending && e.preventDefault()}
            onClose={() => setAsking(false)}
            aria-labelledby="delete-zone-title"
            className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-6 text-foreground shadow-elevated backdrop:bg-[#071a31]/50"
          >
            <h2 id="delete-zone-title" className="text-xl font-semibold">
              Delete “{name}”?
            </h2>
            <p className="mt-3 leading-7 text-muted">
              It has {booths} {plural}. Every booth needs a zone, so choose what happens to {booths === 1 ? "it" : "them"}.
            </p>
            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Its booths</legend>
              {otherZones.length > 0 && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <input type="radio" name="what" checked={!deleteBooths} onChange={() => setDeleteBooths(false)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--brand)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Move {booths === 1 ? "it" : `its ${booths} ${plural}`} to another zone</span>
                    <Select aria-label="Move to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="mt-2" disabled={deleteBooths}>
                      {otherZones.map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </Select>
                  </span>
                </label>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 has-[:checked]:border-danger has-[:checked]:bg-danger/5">
                <input type="radio" name="what" checked={deleteBooths} onChange={() => setDeleteBooths(true)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--danger)]" />
                <span>
                  <span className="block text-sm font-medium">Delete {booths === 1 ? "its booth" : `its ${booths} ${plural}`} too</span>
                  <span className="block text-xs text-muted">They come off the public page. This can&apos;t be undone.</span>
                </span>
              </label>
            </fieldset>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
                Never mind
              </Button>
              <Button type="button" variant="danger" disabled={pending} aria-busy={pending} onClick={() => go(deleteBooths ? null : moveTo)}>
                {pending ? "Deleting…" : deleteBooths ? "Delete zone and booths" : "Move booths and delete zone"}
              </Button>
            </div>
          </dialog>,
          document.body,
        )}
    </div>
  );
}

/** "+ Add zone": add one by name. */
export function NewZoneForm({ action }: { action: FormAction }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Zone name" hint="e.g. Game Zone, Marketplace, Food & Drinks" className="flex-1">
        <Input name="name" required maxLength={60} autoFocus />
      </Field>
      <SubmitButton pendingText="Adding…" className="sm:mb-7">
        Add zone
      </SubmitButton>
    </ActionForm>
  );
}
