"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { prepareLogoUpload, saveBrandColor, saveLogo } from "@/app/dashboard/logo-actions";
import { Button } from "@/components/ui";
import { darkForWhiteText } from "@/lib/brand-color";
import { colorOf } from "@/lib/logo-color";
import { uploadToSignedUrl } from "@/lib/signed-upload";
import { confirmDialog } from "@/components/confirm-dialog";

const TYPES = ["image/png", "image/jpeg"];
const MAX = 2 * 1024 * 1024;

/**
 * The account's logo and color (one for every event): upload, replace, or
 * remove the logo, and pick the color. A new logo sets the color to the
 * logo's main color; the host can change it. Hosts only. No `eventId` on a
 * new event's first step, before the event exists: it's the host's own account.
 */
export function LogoForm({ eventId, logo, color }: { eventId: string | null; logo: string | null; color: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The color being picked, before it's saved.
  const [picked, setPicked] = useState<string | null>(null);
  const shown = picked ?? color;

  // A logo from before colors were saved: read its color once and keep it.
  const filled = useRef(false);
  useEffect(() => {
    if (!logo || color || filled.current) return;
    filled.current = true;
    colorOf(logo).then((c) => {
      if (c) void saveBrandColor(eventId, c).then((r) => !r.error && router.refresh());
    });
  }, [logo, color, eventId, router]);

  async function upload(file: File) {
    setError(null);
    if (!TYPES.includes(file.type)) return setError("Please choose a PNG or JPG image.");
    if (file.size > MAX) return setError("That image is over 2 MB. Try a smaller one.");
    setBusy("Uploading…");
    const local = URL.createObjectURL(file);
    const fromLogo = await colorOf(local);
    URL.revokeObjectURL(local);
    const ticket = await prepareLogoUpload(eventId, { contentType: file.type, size: file.size });
    if (ticket.error || !ticket.path || !ticket.url) {
      setBusy(null);
      return setError(ticket.error ?? "We couldn't start the upload. Please try again.");
    }
    if (!(await uploadToSignedUrl(ticket.url, file))) {
      setBusy(null);
      return setError("The upload didn't go through. Check your connection and try again.");
    }
    setBusy("Saving…");
    const saved = await saveLogo(eventId, ticket.path);
    // A new logo brings its own color; the host can change it below.
    if (!saved.error && fromLogo) await saveBrandColor(eventId, fromLogo);
    setBusy(null);
    if (saved.error) return setError(saved.error);
    setPicked(null);
    router.refresh();
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Remove the logo?",
      message: "Your event pages and badges go back to the standard look.",
      confirmLabel: "Remove logo",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    setBusy("Removing…");
    const saved = await saveLogo(eventId, null);
    if (!saved.error) await saveBrandColor(eventId, null);
    setBusy(null);
    if (saved.error) return setError(saved.error);
    setPicked(null);
    router.refresh();
  }

  async function saveColor(next: string | null) {
    setError(null);
    setBusy("Saving the color…");
    const saved = await saveBrandColor(eventId, next);
    setBusy(null);
    if (saved.error) return setError(saved.error);
    setPicked(null);
    router.refresh();
  }

  async function useLogoColor() {
    if (!logo) return;
    const c = await colorOf(logo);
    if (c) await saveColor(c);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className={`flex h-16 w-32 items-center justify-center rounded-md border p-2 ${logo ? "border-border bg-white" : "border-dashed border-field-border bg-surface"}`}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Your logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted">No logo yet</span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Choose a logo image"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <Button type="button" variant="secondary" disabled={!!busy} onClick={() => input.current?.click()}>
              {logo ? "Replace logo" : "Upload logo"}
            </Button>
            {logo && (
              <Button type="button" variant="danger" disabled={!!busy} onClick={remove}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {busy ?? "PNG or JPG, up to 2 MB"}
          </p>
        </div>
      </div>

      {logo && (
        <div>
          <p className="text-sm font-semibold">Your color</p>
          <p className="mt-1 text-sm text-muted">
            Used for the band behind your event name, buttons, and links on your public pages, and on badges. It starts as your
            logo&apos;s main color.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/* A preview of the band, as people will see it. */}
            <span
              className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-bold tracking-wide text-white"
              style={{ backgroundColor: darkForWhiteText(shown ?? "#0b3558") }}
            >
              VOLUNTEER
            </span>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-field-border bg-surface px-3 text-sm font-medium hover:border-brand">
              <input
                type="color"
                value={shown ?? "#0b3558"}
                onChange={(e) => setPicked(e.target.value)}
                className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Pick your color"
              />
              Change color
            </label>
            {picked && picked !== color && (
              <Button type="button" disabled={!!busy} onClick={() => saveColor(picked)}>
                Save color
              </Button>
            )}
            {!picked && (
              <Button type="button" variant="ghost" disabled={!!busy} onClick={useLogoColor}>
                Use the logo&apos;s color
              </Button>
            )}
          </div>
          {shown && darkForWhiteText(shown) !== shown && (
            <p className="mt-2 text-xs text-muted">Darkened a little so white text on it stays easy to read.</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
