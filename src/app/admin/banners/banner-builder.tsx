"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SiteBannerView } from "@/components/site-banner";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action-state";
import { BANNER_AUDIENCES, BANNER_TONES, HOST_FILTERS, type BannerTone, type SiteBanner } from "@/lib/banner-types";
import { confirmDialog } from "@/components/confirm-dialog";
import { DateField } from "@/components/date-field";
import { TimeField } from "@/components/time-field";

const field =
  "w-full rounded-sm border border-border bg-surface px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25";

/**
 * Write a banner: what it says, how it looks, who sees it and when, with a
 * live preview and how many people it will reach.
 */
export function BannerBuilder({
  action,
  banner,
  reach,
  defaults,
  onEnd,
  onDelete,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  banner?: SiteBanner & { startsLocal: string; endsLocal: string };
  /** People each audience (and host filter) reaches, e.g. { hosts:all: 12 }. */
  reach: Record<string, number>;
  defaults: { startsLocal: string; endsLocal: string };
  onEnd?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [title, setTitle] = useState(banner?.title ?? "");
  const [body, setBody] = useState(banner?.body ?? "");
  const [linkLabel, setLinkLabel] = useState(banner?.link_label ?? "");
  const [linkUrl, setLinkUrl] = useState(banner?.link_url ?? "");
  const [tone, setTone] = useState<BannerTone>(banner?.tone ?? "info");
  const [audience, setAudience] = useState<string>(banner?.audience ?? "hosts");
  const [hostFilter, setHostFilter] = useState<string>(banner?.host_filter ?? "all");
  const cleared = useCallback(() => {
    setTitle("");
    setBody("");
    setLinkLabel("");
    setLinkUrl("");
  }, []);

  const n = audience === "public" ? null : reach[audience === "hosts" ? `hosts:${hostFilter}` : audience] ?? 0;
  const where = BANNER_AUDIENCES.find((a) => a.value === audience)?.where;

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <ActionForm action={action} resetOnSuccess={!banner} onSuccess={banner ? undefined : cleared} className="min-w-0 space-y-3">
        {banner && <input type="hidden" name="id" value={banner.id} />}
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted">Headline</span>
          <input name="title" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New: email templates for your volunteers" className={`${field} h-9`} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-muted">Message (optional)</span>
          <textarea name="body" maxLength={600} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="One or two sentences." className={`${field} py-2`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Link text (optional)</span>
            <input name="link_label" maxLength={60} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Learn more" className={`${field} h-9`} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Link address</span>
            <input name="link_url" type="url" maxLength={500} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className={`${field} h-9`} />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-muted">Style</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {BANNER_TONES.map((t) => (
              <label key={t.value} className="flex items-start gap-2 rounded-sm border border-border px-2.5 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="tone" value={t.value} checked={tone === t.value} onChange={() => setTone(t.value)} className="mt-1" />
                <span>
                  <span className="font-semibold">{t.label}</span>
                  <span className="block text-xs text-muted">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted">Who sees it</span>
            <select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} className={`${field} h-9`}>
              {BANNER_AUDIENCES.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {audience === "hosts" && (
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-muted">Which hosts</span>
              <select name="host_filter" value={hostFilter} onChange={(e) => setHostFilter(e.target.value)} className={`${field} h-9`}>
                {HOST_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DayAndTime name="starts_at" label="Starts (Central time)" initial={banner?.startsLocal ?? defaults.startsLocal} />
          <DayAndTime name="ends_at" label="Ends (leave blank to keep it up)" initial={banner ? banner.endsLocal : defaults.endsLocal} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex gap-3 text-sm">
            {banner && (
              <Link href="/admin/banners" className="text-muted hover:text-foreground">
                Close
              </Link>
            )}
            {onEnd && (
              <button type="button" onClick={() => onEnd()} className="text-muted hover:text-foreground">
                End now
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={async () => {
                  if (await confirmDialog({ title: "Delete this banner?", confirmLabel: "Delete banner", danger: true })) await onDelete();
                }}
                className="text-muted hover:text-danger"
              >
                Delete
              </button>
            )}
          </div>
          <SubmitButton className="h-9 min-h-9! rounded-sm px-4">{banner ? "Save changes" : "Post banner"}</SubmitButton>
        </div>
      </ActionForm>

      <div className="min-w-0 space-y-2">
        <span className="text-xs font-semibold text-muted">Preview</span>
        <div className="rounded-md border border-border bg-background p-4">
          <SiteBannerView
            banner={{ title: title || "Your headline", body: body || null, link_label: linkLabel || null, link_url: linkUrl || null, tone }}
            onDismiss={tone === "urgent" ? undefined : () => {}}
          />
        </div>
        <p className="text-sm">
          {n === null ? (
            <>Shows to <strong>everyone who visits the home page</strong>.</>
          ) : (
            <>
              Shows to <strong>{n}</strong> {n === 1 ? "person" : "people"} on {where}.
            </>
          )}{" "}
          <span className="text-muted">
            {tone === "urgent" ? "Urgent banners can't be closed; they stay until they end." : "People can close it; it stays closed for them."}
          </span>
        </p>
      </div>
    </div>
  );
}

/** A day box and a time box side by side, sent as one "2026-11-16T15:30" value (as the browser's box did). */
function DayAndTime({ name, label, initial }: { name: string; label: string; initial: string }) {
  const [day, setDay] = useState(initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11, 16));
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-muted">{label}</legend>
      <div className="grid gap-2">
        <DateField value={day} onChange={(e) => setDay(e.target.value)} aria-label={`${label}: day`} />
        {/* A day needs its time: an empty one would quietly mean midnight. */}
        <TimeField value={time} required={Boolean(day)} onChange={(e) => setTime(e.target.value)} aria-label={`${label}: time`} />
      </div>
      <input type="hidden" name={name} value={day && time ? `${day}T${time}` : ""} />
    </fieldset>
  );
}
