"use client";

import { useEffect, useId, useRef, useState } from "react";
import { copyDialog } from "@/components/confirm-dialog";
import { Button, Field, FieldError, Input, Select } from "@/components/ui";
import { prepareSponsorLogoUpload, processSponsorLogo, saveSponsor, type UploadedLogo } from "@/app/dashboard/sponsor-actions";
import { displayLink, LIVE_NAMES, LOGO, logoWarnings, MAX_LEVELS, normalizeSponsorLink, organizerSponsorLogoUrl, tileFor, TILES, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import { TilePreview, LOGO_TILE } from "./logo-tile";
import { Window } from "./window";
import { LOGO_SHORT, LOGO_SPEC, logoEmail, logoWhere, ordinal, plural, sponsorKindWords, tileSizes } from "./words";

const ERR_INPUT = "border-danger! ring-2 ring-danger/20";

type Upload = { phase: "uploading" | "checking"; pct: number; file: string; xhr: XMLHttpRequest | null };

/** Send the file to its one-time upload link with progress (as src/lib/signed-upload.ts, which can't report it). */
function putWithProgress(url: string, file: File, onProgress: (pct: number) => void, onXhr: (x: XMLHttpRequest) => void) {
  return new Promise<"ok" | "failed" | "stopped">((resolve) => {
    const xhr = new XMLHttpRequest();
    onXhr(xhr);
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? "ok" : "failed");
    xhr.onerror = () => resolve("failed");
    xhr.onabort = () => resolve("stopped");
    xhr.send(body);
  });
}

/**
 * Add a sponsor, or edit one (boards 4 and 7, with the light check's fixes): name, level (none when the event has
 * no levels; "New level…" until 4), logo with its short line and the full requirements, website with the link we'll
 * use, Show on the public page, and Presented by. Errors keep everything typed. Remove lives here, in red.
 */
export function SponsorWindow({
  eventId,
  eventName,
  eventType,
  levels,
  sponsors,
  sponsor,
  from,
  group,
  onClose,
  onSaved,
  onRemove,
}: {
  eventId: string;
  eventName: string;
  eventType: string;
  levels: SponsorLevel[];
  /** The event's sponsors (for counts and who's Presented by now). */
  sponsors: Sponsor[];
  /** Editing this one; adding without it. */
  sponsor?: Sponsor | null;
  from: string;
  group: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  onRemove: (s: Sponsor) => void;
}) {
  const ids = useId();
  const editing = Boolean(sponsor);
  const [name, setName] = useState(sponsor?.name ?? "");
  const [level, setLevel] = useState<string>(sponsor?.levelId ?? "");
  const [newLevel, setNewLevel] = useState("");
  // No levels yet: "Add levels" asks for the first one's name here (it takes everyone in).
  const [addingFirst, setAddingFirst] = useState(false);
  const [website, setWebsite] = useState(sponsor?.website ? displayLink(sponsor.website) : "");
  const [websiteNote, setWebsiteNote] = useState<string | null>(null);
  const [show, setShow] = useState(sponsor?.showPublic ?? true);
  const [presents, setPresents] = useState(sponsor?.presentedBy ?? false);
  // undefined: keep the saved logo; null: remove it; an upload: replace it.
  const [logo, setLogo] = useState<UploadedLogo | null | undefined>(undefined);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [waitingForUpload, setWaitingForUpload] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const who = name.trim() || "the sponsor";
  const words = sponsorKindWords(eventType);
  const others = sponsors.filter((s) => s.id !== sponsor?.id);
  const currentPresents = others.find((s) => s.presentedBy) ?? null;
  const levelIndex = levels.findIndex((l) => l.id === level);
  const full = levels.length >= MAX_LEVELS;

  // The logo as it stands in the window: just uploaded, the saved one, or none.
  const shown =
    logo === null
      ? null
      : logo
        ? { src: logo.previews, width: logo.width, height: logo.height }
        : sponsor?.logoVersion && sponsor.logoWidth && sponsor.logoHeight
          ? {
              src: {
                t0: organizerSponsorLogoUrl(eventId, sponsor.logoVersion, "t0")!,
                t1: organizerSponsorLogoUrl(eventId, sponsor.logoVersion, "t1")!,
                t2: organizerSponsorLogoUrl(eventId, sponsor.logoVersion, "t2")!,
              },
              width: sponsor.logoWidth,
              height: sponsor.logoHeight,
            }
          : null;
  // The sponsor who's Presented by may be hidden (the line hides with them); nobody hidden can become it.
  const canPresent = show || Boolean(sponsor?.presentedBy);
  const warn = shown ? logoWarnings(shown.width, shown.height) : null;

  // Errors per box, worked out the same way on leaving a box and on Add (nothing is red until then: L22).
  const check = (field: string) => {
    if (field === "name") return name.trim() ? null : "Fill this in";
    if (field === "level") return levels.length && !level ? "Pick a level" : null;
    if (field === "newLevel") return level === "new" && !newLevel.trim() ? "Fill this in" : null;
    if (field === "firstLevel") return addingFirst && !newLevel.trim() ? "Fill this in" : null;
    if (field === "website") return normalizeSponsorLink(website).error ?? null;
    return null;
  };
  const leave = (field: string) => {
    const e = check(field);
    setErrors((prev) => {
      const next = { ...prev };
      if (e && (tried || field === "website" || field === "name")) next[field] = e;
      else delete next[field];
      return next;
    });
  };
  const websiteLeft = () => {
    leave("website");
    const link = normalizeSponsorLink(website);
    setWebsiteNote(link.url && link.changed && /^http:|[?&]/i.test(website) ? `We'll link to ${link.url}, secure and without the tracking part.` : link.url && link.changed ? `We'll link to ${link.url}` : null);
  };

  const submit = async (after?: { logo: UploadedLogo }) => {
    setTried(true);
    setFormError(null);
    const all: Record<string, string> = {};
    for (const f of ["name", "level", "newLevel", "firstLevel", "website"]) {
      const e = check(f);
      if (e) all[f] = e;
    }
    setErrors(all);
    if (Object.keys(all).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    // A logo still on its way: the sponsor is added once it's in.
    if (upload && !after) {
      setWaitingForUpload(true);
      return;
    }
    setWaitingForUpload(false);
    const useLogo = after ? after.logo : logo;
    setSaving(true);
    const res = await saveSponsor(eventId, {
      sponsorId: sponsor?.id ?? null,
      name,
      levelId: level && level !== "new" ? level : null,
      newLevelName: level === "new" || addingFirst ? newLevel : null,
      website,
      logo: useLogo === undefined ? undefined : useLogo === null ? null : { path: useLogo.path, width: useLogo.width, height: useLogo.height },
      show,
      presentedBy: canPresent && presents,
    }).catch(() => ({ error: "No connection", fieldErrors: undefined }));
    setSaving(false);
    if (res.fieldErrors && Object.keys(res.fieldErrors).length) {
      const map: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.fieldErrors)) map[k === "newLevelName" ? (addingFirst ? "firstLevel" : "newLevel") : k === "levelId" ? "level" : k] = v;
      setErrors(map);
      return;
    }
    if (res.error) {
      setFormError(`Couldn't ${editing ? "save" : "add"} ${name.trim()}: ${res.error.replace(/\.$/, "")}. Everything you typed is still here.`);
      return;
    }
    onSaved(editing ? `Saved ${name.trim()}` : `Added ${name.trim()}`);
  };

  // The latest submit, for finishing an Add pressed while the logo was still uploading.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const waiting = useRef(false);
  useEffect(() => {
    waiting.current = waitingForUpload;
  }, [waitingForUpload]);

  const pick = async (file: File) => {
    setLogoError(null);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!(LOGO.types as readonly string[]).includes(file.type)) {
      setLogoError(
        isPdf
          ? `${file.name} is a PDF, which can't show on a web page. Ask ${who} for a PNG or JPG, or save the PDF as a PNG and upload that.`
          : `${file.name} isn't a PNG or JPG, so it can't show on a web page. Ask ${who} for a PNG or JPG.`,
      );
      return;
    }
    if (file.size > LOGO.maxBytes) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      setLogoError(`This file is ${mb} MB, over the ${LOGO.maxMB} MB limit. Save it smaller, or ask ${who} for a PNG or JPG under ${LOGO.maxMB} MB.`);
      return;
    }
    setUpload({ phase: "uploading", pct: 0, file: file.name, xhr: null });
    const start = await prepareSponsorLogoUpload(eventId, { contentType: file.type, size: file.size }).catch(() => ({ error: "No connection. Check it, then try again", url: undefined, path: undefined }));
    if (start.error || !start.url || !start.path) {
      setUpload(null);
      setLogoError(`${(start.error ?? "We couldn't start the upload").replace(/\.$/, "")}.`);
      return;
    }
    const sent = await putWithProgress(
      start.url,
      file,
      (pct) => setUpload((u) => (u ? { ...u, pct } : u)),
      (xhr) => setUpload((u) => (u ? { ...u, xhr } : u)),
    );
    if (sent !== "ok") {
      setUpload(null);
      setWaitingForUpload(false);
      setLogoError(sent === "stopped" ? "Upload stopped. The logo wasn't changed." : "The upload didn't finish. Check your connection, then upload it again.");
      return;
    }
    setUpload((u) => (u ? { ...u, phase: "checking", pct: 100 } : u));
    const done = await processSponsorLogo(eventId, start.path).catch(() => ({ error: "No connection. Check it, then upload it again", logo: undefined }));
    if (done.error || !done.logo) {
      const msg = (done.error ?? "We couldn't use that image").replace(/\.$/, "");
      setLogoError(/too small/.test(msg) ? `${msg}. Ask ${who} for one at least ${LOGO.minWidth} pixels wide.` : `${msg}.`);
      setUpload(null);
      setWaitingForUpload(false);
      return;
    }
    setLogo(done.logo);
    setUpload(null);
    // Add was pressed while it uploaded: finish it now.
    if (waiting.current) void submitRef.current({ logo: done.logo });
  };

  const copyEmail = async () => {
    const text = logoEmail({ event: eventName, eventType, sponsor: name.trim() || undefined, from, group });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      await copyDialog("Copy the email to send your sponsors", text);
    }
  };

  const errorProps = (field: string) =>
    errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${ids}-${field}-err`, className: ERR_INPUT } : {};
  const tileHere = tileFor(levels.length ? (levelIndex >= 0 ? levelIndex : level === "new" ? levels.length : null) : null);
  const firstLevel = levels[0]?.name;

  return (
    <Window
      wide
      title={editing ? `Edit ${sponsor!.name}` : "Add a sponsor"}
      onClose={onClose}
      actions={
        <>
          {editing && (
            <Button type="button" variant="warn" className="sm:mr-auto" onClick={() => onRemove(sponsor!)} disabled={saving}>
              Remove<span className="sr-only"> {sponsor!.name}</span>
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving || waitingForUpload} aria-busy={saving}>
            {saving ? "Saving…" : waitingForUpload ? "Adding once uploaded…" : formError ? "Try again" : editing ? "Save changes" : "Add sponsor"}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {formError && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 font-semibold text-danger">
            {formError}
          </p>
        )}
        <Field label="Name" error={errors.name} errorId={`${ids}-name-err`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => leave("name")} placeholder="For example, Oak Street Dental" maxLength={100} required autoComplete="off" {...errorProps("name")} />
        </Field>

        {levels.length > 0 ? (
          <>
            <Field
              label="Level"
              error={errors.level}
              errorId={`${ids}-level-err`}
              hint={full ? "4 levels is the most. To change them, use Change levels on the Sponsors page." : undefined}
            >
              <Select value={level} onChange={(e) => setLevel(e.target.value)} onBlur={() => leave("level")} required {...errorProps("level")}>
                <option value="" disabled>
                  Pick a level
                </option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
                {!full && <option value="new">New level…</option>}
              </Select>
            </Field>
            {level === "new" && (
              <div className="-mt-1 rounded-md border border-border bg-background p-3">
                <Field
                  label="New level's name"
                  error={errors.newLevel}
                  errorId={`${ids}-newLevel-err`}
                  hint={errors.newLevel ? undefined : `It goes after ${levels.at(-1)!.name}, with ${TILES[levels.length].size}. You can change the order with Change levels.`}
                >
                  <Input value={newLevel} onChange={(e) => setNewLevel(e.target.value)} onBlur={() => leave("newLevel")} placeholder="For example, Friend" maxLength={40} required {...errorProps("newLevel")} />
                </Field>
              </div>
            )}
          </>
        ) : addingFirst ? (
          <div className="rounded-md border border-border bg-background p-3">
            <Field
              label="First level's name"
              error={errors.firstLevel}
              errorId={`${ids}-firstLevel-err`}
              hint={
                others.length
                  ? `Your ${plural(others.length, "sponsor")} so far go${others.length === 1 ? "es" : ""} into it too, and so does this one. You can add up to ${MAX_LEVELS - 1} more levels and move sponsors after.`
                  : `You can add up to ${MAX_LEVELS - 1} more levels after.`
              }
            >
              <Input value={newLevel} onChange={(e) => setNewLevel(e.target.value)} onBlur={() => leave("firstLevel")} placeholder="For example, Gold" maxLength={40} required {...errorProps("firstLevel")} />
            </Field>
            <Button
              type="button"
              variant="ghost"
              className="mt-1 px-0!"
              onClick={() => {
                setAddingFirst(false);
                setNewLevel("");
                setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== "firstLevel")));
              }}
            >
              Don&apos;t add levels
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="min-w-0 flex-1 basis-56 text-muted">
              No levels: {editing ? `all ${plural(sponsors.length, "sponsor")}` : `all ${plural(others.length + 1, "sponsor")}`} will show at the same size.
            </p>
            <Button type="button" variant="secondary" onClick={() => setAddingFirst(true)}>
              Add levels
            </Button>
          </div>
        )}

        {/* The logo: one short line, then "Logo requirements" with the full list and the email to copy. */}
        <div>
          <p className="text-sm font-semibold" id={`${ids}-logo`}>
            Logo (optional)
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {upload ? (
              <span className="flex h-16 w-32 flex-col items-center justify-center gap-1.5 rounded-md border border-field-border bg-surface p-2 text-xs font-medium" role="status">
                {upload.phase === "checking" ? "Checking…" : `Uploading… ${upload.pct}%`}
                <span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full border border-field-border">
                  <span className="block h-full bg-brand" style={{ width: `${upload.pct}%` }} />
                </span>
              </span>
            ) : shown ? (
              <span className={`flex h-16 w-32 items-center justify-center rounded-md p-2 ${LOGO_TILE}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own resized copy */}
                <img src={shown.src.t1} alt={`${who} logo`} className="max-h-full max-w-full object-contain" />
              </span>
            ) : (
              <span className="flex h-16 w-32 items-center justify-center rounded-md border border-dashed border-field-border bg-surface p-2 text-xs">No logo yet</span>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
            />
            {upload ? (
              <Button type="button" variant="secondary" onClick={() => upload.xhr?.abort()} disabled={upload.phase === "checking"}>
                Stop upload
              </Button>
            ) : shown ? (
              <>
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
                  Replace logo
                </Button>
                <Button type="button" variant="secondary" onClick={() => setLogo(null)}>
                  Remove logo
                </Button>
              </>
            ) : (
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} aria-describedby={`${ids}-logo`}>
                Upload logo
              </Button>
            )}
          </div>
          {logoError ? (
            <p role="alert" className="mt-1.5 text-sm font-semibold text-danger">
              {logoError}
            </p>
          ) : upload ? (
            <p className="mt-1.5 text-sm">{upload.file}: the sponsor is {editing ? "saved" : "added"} once the upload finishes.</p>
          ) : (
            <p className="mt-1.5 text-sm text-muted">{LOGO_SHORT}. No logo? Their name shows instead.</p>
          )}
          {warn && shown && (warn.small || warn.tall) && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              {warn.small && warn.tall ? (
                <>
                  <span className="font-semibold">This logo is {shown.width} pixels wide, so it may look blurry,</span> and it&apos;s taller than it is wide, so it shows small. Ask{" "}
                  {who} for a wide one at least {LOGO.minWidth} pixels wide. You can save this one for now.
                </>
              ) : warn.small ? (
                <>
                  <span className="font-semibold">This logo is {shown.width} pixels wide, so it may look blurry.</span> Ask {who} for one at least {LOGO.minWidth} pixels wide. You can
                  save this one for now.
                </>
              ) : (
                <>
                  <span className="font-semibold">This logo is taller than it is wide, so it shows small.</span> Ask {who} for a wide one if they have it. You can save this one
                  for now.
                </>
              )}
            </p>
          )}
          <details className="group mt-1">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-brand [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                ›
              </span>
              <span className="underline underline-offset-4">Logo requirements</span>
            </summary>
            <div className="mt-1 space-y-3 rounded-md border border-border bg-background p-3">
              <dl className="space-y-2">
                {LOGO_SPEC.map((x) => (
                  <div key={x.k}>
                    <dt className="font-semibold">{x.k}</dt>
                    <dd>{x.v}</dd>
                  </div>
                ))}
                <div>
                  <dt className="font-semibold">Where it appears</dt>
                  <dd>{logoWhere(eventType)}</dd>
                </div>
                <div>
                  <dt className="font-semibold">How big it shows on the public page (screen pixels)</dt>
                  <dd>
                    <ul className="list-disc pl-5">
                      {tileSizes(levels.map((l) => l.name)).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <span className="mt-1 block">Phones use 2 or more image pixels for each screen pixel, so {LOGO.minWidth} pixels wide keeps the biggest tile sharp.</span>
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                <Button type="button" variant="secondary" onClick={copyEmail}>
                  Copy the email to send your sponsors
                </Button>
                {copied && (
                  <span role="status" className="text-sm font-medium">
                    <span aria-hidden className="text-success">
                      ✓{" "}
                    </span>
                    Copied. Paste it into an email to {name.trim() || "your sponsor"}
                  </span>
                )}
              </div>
            </div>
          </details>
        </div>

        {shown && (
          <div className="rounded-md border border-border bg-background p-3">
            <p className="text-sm font-semibold">How it shows</p>
            <div className="mt-2 grid items-start gap-3 sm:grid-cols-2">
              {levels.length > 0 && levelIndex !== 0 && (
                <div>
                  <p className="mb-1 text-xs">{levels[0].name} tile (the biggest level)</p>
                  <TilePreview tile={TILES[0]} name={name} src={shown.src.t0} width={shown.width} height={shown.height} />
                </div>
              )}
              <div>
                <p className="mb-1 text-xs">
                  {levels.length === 0 ? "Every sponsor's tile (no levels)" : levelIndex >= 0 ? `${levels[levelIndex].name} tile (their level)` : level === "new" ? `${ordinal(levels.length + 1)} level tile (the new level)` : "Their level's tile, once you pick one"}
                </p>
                <TilePreview tile={tileHere} name={name} src={shown.src[tileHere.file]} width={shown.width} height={shown.height} />
              </div>
            </div>
            <p className="mt-3 text-xs">Live line on {words.day}: names only, no logos</p>
            <p className="mt-1 text-sm">
              {levels.length === 0
                ? `It names the first ${LIVE_NAMES} sponsors in your list`
                : levelIndex === 0
                  ? `${who === "the sponsor" ? "They're" : `${who} is`} named if among the first ${LIVE_NAMES} ${firstLevel} sponsors`
                  : `Not named: the live line names the first ${LIVE_NAMES} ${firstLevel} sponsors`}
            </p>
          </div>
        )}

        <Field label="Website (optional)" error={errors.website} errorId={`${ids}-website-err`} hint={errors.website ? undefined : (websiteNote ?? "Their logo opens it in a new tab.")}>
          <Input
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value);
              setWebsiteNote(null);
            }}
            onBlur={websiteLeft}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="For example, oakstreetdental.com"
            maxLength={400}
            {...errorProps("website")}
          />
        </Field>

        <div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5">
            <input type="checkbox" role="switch" checked={show} onChange={(e) => setShow(e.target.checked)} className="peer sr-only" />
            <span
              aria-hidden
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand/40 ${show ? "border-brand bg-brand" : "border-field-border bg-background"}`}
            >
              <span className={`absolute size-4 rounded-full ${show ? "left-[22px] bg-brand-foreground" : "left-[3px] bg-field-border"}`} />
            </span>
            <span className="text-sm font-medium">Show on the public page</span>
          </label>
          <p className="text-sm text-muted">Turn it off to add a sponsor now and show them later.</p>
        </div>

        <label className={`flex min-h-11 items-start gap-3 py-1.5 ${canPresent ? "cursor-pointer" : ""}`}>
          <input type="checkbox" checked={canPresent && presents} disabled={!canPresent} onChange={(e) => setPresents(e.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--brand)]" />
          <span>
            <span className="font-medium">Presented by</span>
            <span className="block text-muted">
              {show
                ? `Their logo and name show under your ${words.kind}'s name.${currentPresents && !sponsor?.presentedBy ? ` ${currentPresents.name} is now; this replaces them.` : ""}`
                : canPresent
                  ? "While they're hidden, the Presented by line doesn't show either."
                  : "Hidden sponsors can't be Presented by. Show them on the public page first."}
            </span>
          </span>
        </label>
        {tried && Object.keys(errors).length > 0 && (
          <FieldError>
            <span role="alert">Fill in or check the boxes outlined in red.</span>
          </FieldError>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Window>
  );
}
