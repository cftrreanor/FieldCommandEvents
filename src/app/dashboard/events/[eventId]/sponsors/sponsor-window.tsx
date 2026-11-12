"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { copyDialog } from "@/components/confirm-dialog";
import { Button, FieldError, Input, Select } from "@/components/ui";
import { prepareSponsorLogoUpload, processSponsorLogo, saveSponsor, type UploadedLogo } from "@/app/dashboard/sponsor-actions";
import { displayLink, LIVE_NAMES, LOGO, logoWarnings, MAX_LEVELS, normalizeSponsorLink, organizerSponsorLogoUrl, tileFor, TILES, type Sponsor, type SponsorLevel } from "@/lib/sponsors";
import { TilePreview, LOGO_TILE } from "./logo-tile";
import { Window } from "./window";
import { listAnd, LOGO_SHORT, LOGO_SPEC, logoEmail, logoWhere, plural, sponsorKindWords, tileSizes } from "./words";

const ERR_INPUT = "border-danger! ring-2 ring-danger/20";

/** A labeled box with its error directly under it, above the hint (light check). */
function SField({ label, hint, error, errorId, children }: { label: string; hint?: ReactNode; error?: string; errorId?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span data-field-label className="text-sm font-semibold">
        {label}
      </span>
      {children}
      {error && <FieldError id={errorId}>{error}</FieldError>}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  );
}

/** What to do about each box, for the summary ("Enter a name and pick a level, then try again."). */
const FIX: Record<string, string> = {
  name: "enter a name",
  level: "pick a level",
  newLevel: "name the level",
  firstLevel: "name the level",
  website: "check the website",
};
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

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
  eventDate,
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
  /** "Sat, Dec 5, 2026", for the copied email. */
  eventDate: string;
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
  const [logoError, setLogoError] = useState<{ file: string; text: string } | null>(null);
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
    if (field === "name") return name.trim() ? null : "Enter the sponsor's name";
    if (field === "level") return levels.length && !level ? "Pick a level" : null;
    if (field === "newLevel") return level === "new" && !newLevel.trim() ? "Name the level" : null;
    if (field === "firstLevel") return addingFirst && !newLevel.trim() ? "Name the level" : null;
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
    const fail = (text: string) => setLogoError({ file: file.name, text: `${text.replace(/\.$/, "")}.` });
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    if (!(LOGO.types as readonly string[]).includes(file.type)) {
      fail(isPdf ? `A PDF can't show on a web page. Ask ${who} for a PNG or JPG` : `It isn't a PNG or JPG, so it can't show on a web page. Ask ${who} for a PNG or JPG`);
      return;
    }
    if (file.size > LOGO.maxBytes) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      fail(`It's ${mb} MB, over the ${LOGO.maxMB} MB limit. Save it smaller, or ask ${who} for a PNG or JPG under ${LOGO.maxMB} MB`);
      return;
    }
    setUpload({ phase: "uploading", pct: 0, file: file.name, xhr: null });
    const start = await prepareSponsorLogoUpload(eventId, { contentType: file.type, size: file.size, sponsor: name.trim() }).catch(() => ({ error: "No connection. Check it, then try again", url: undefined, path: undefined }));
    if (start.error || !start.url || !start.path) {
      setUpload(null);
      fail(start.error ?? "We couldn't start the upload");
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
      fail(sent === "stopped" ? "Upload stopped. The logo wasn't changed" : "The upload didn't finish. Check your connection, then upload it again");
      return;
    }
    setUpload((u) => (u ? { ...u, phase: "checking", pct: 100 } : u));
    const done = await processSponsorLogo(eventId, start.path, name.trim()).catch(() => ({ error: "No connection. Check it, then upload it again", logo: undefined }));
    if (done.error || !done.logo) {
      fail(done.error ?? "We couldn't use that image");
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
    const text = logoEmail({ event: eventName, date: eventDate, eventType, sponsor: name.trim() || undefined, from, group });
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
      row
      title={editing ? `Edit ${sponsor!.name}` : "Add a sponsor"}
      onClose={onClose}
      actions={
        <>
          {/* On phones Remove sits in the window's body ("Remove this sponsor"), apart from Save and Cancel. */}
          {editing && (
            <Button type="button" variant="warn" className="mr-auto max-sm:hidden" onClick={() => onRemove(sponsor!)} disabled={saving}>
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
        <SField label="Name" error={errors.name} errorId={`${ids}-name-err`}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => leave("name")} placeholder="For example, Oak Street Dental" maxLength={100} required autoComplete="off" {...errorProps("name")} />
        </SField>

        {levels.length > 0 ? (
          <>
            <SField
              label="Level"
              error={errors.level}
              errorId={`${ids}-level-err`}
              hint={full ? `You have ${MAX_LEVELS} levels, the most. To add one, remove a level in Change levels.` : undefined}
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
            </SField>
            {level === "new" && (
              <div className="-mt-1 rounded-md border border-border bg-background p-3">
                <SField
                  label="New level's name"
                  error={errors.newLevel}
                  errorId={`${ids}-newLevel-err`}
                  hint={`It goes after ${levels.at(-1)!.name}, with ${TILES[levels.length].size}. You can change the order with Change levels.`}
                >
                  <Input value={newLevel} onChange={(e) => setNewLevel(e.target.value)} onBlur={() => leave("newLevel")} placeholder="For example, Friend" maxLength={40} required {...errorProps("newLevel")} />
                </SField>
              </div>
            )}
          </>
        ) : addingFirst ? (
          <div className="rounded-md border border-border bg-background p-3">
            <SField
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
            </SField>
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

        {/* The logo: one short line, then "Logo requirements" with the full list and the email to copy. A problem
            with the file is one line inside the logo's box, naming the file. */}
        <div>
          <p className="text-sm font-semibold" id={`${ids}-logo`}>
            Logo (optional)
          </p>
          <div className={`mt-1.5 rounded-md border p-3 ${logoError ? "border-danger" : "border-border"}`}>
            <div className="flex flex-wrap items-center gap-3">
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
              <p role="alert" className="mt-2 text-sm text-danger [overflow-wrap:anywhere]">
                <span className="font-semibold">{logoError.file}:</span> {logoError.text}
              </p>
            ) : upload ? (
              <p className="mt-2 text-sm [overflow-wrap:anywhere]">
                {upload.file}: the sponsor is {editing ? "saved" : "added"} once the upload finishes.
              </p>
            ) : null}
          </div>
          <p className="mt-1.5 text-sm text-muted">{LOGO_SHORT}. No logo? Their name shows instead.</p>
          {warn && shown && (warn.small || warn.tall) && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              {warn.small && warn.tall ? (
                <>
                  <span className="font-semibold">
                    This logo is {shown.width} pixels wide and taller than it is wide, so it may look blurry and shows small.
                  </span>{" "}
                  Ask {who} for a wide logo, {LOGO.minWidth} pixels wide or more. You can save this one for now.
                </>
              ) : warn.small ? (
                <>
                  <span className="font-semibold">This logo is {shown.width} pixels wide, so it may look blurry.</span> Ask {who} for one {LOGO.minWidth} pixels wide or more. You
                  can save this one for now.
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
                    <span className="mt-1 block">Phones use 2 or more image pixels for each screen pixel, so {LOGO.minWidth} pixels wide keeps the biggest size sharp.</span>
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
                  <p className="mb-1 text-xs">At {levels[0].name} size (the biggest)</p>
                  <TilePreview tile={TILES[0]} name={name} src={shown.src.t0} width={shown.width} height={shown.height} />
                </div>
              )}
              <div>
                <p className="mb-1 text-xs">
                  {levels.length === 0
                    ? "At every sponsor's size (no levels)"
                    : levelIndex === 0
                      ? `At ${levels[0].name} size (the biggest, their level)`
                      : levelIndex > 0
                        ? `At ${levels[levelIndex].name} size (their level)`
                        : level === "new"
                          ? "At the new level's size"
                          : "At their level's size, once you pick one"}
                </p>
                <TilePreview tile={tileHere} name={name} src={shown.src[tileHere.file]} width={shown.width} height={shown.height} />
              </div>
            </div>
            <p className="mt-3 text-xs">On {words.day}: names only, no logos</p>
            <p className="mt-1 text-sm">
              {levels.length === 0
                ? `${capital(words.liveShort)} names the first ${LIVE_NAMES} sponsors in your list`
                : levelIndex === 0
                  ? `Named on ${words.day} if among the first ${LIVE_NAMES} ${firstLevel} sponsors`
                  : `Not named on ${words.day}: ${words.liveShort} names the first ${LIVE_NAMES} ${firstLevel} sponsors`}
            </p>
          </div>
        )}

        <SField label="Website (optional)" error={errors.website} errorId={`${ids}-website-err`} hint={websiteNote ?? "Their logo or name links here, in a new tab."}>
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
        </SField>

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
                ? `Their logo and name show under your ${words.kind}'s name.${currentPresents && !sponsor?.presentedBy ? ` ${currentPresents.name} is presenting now. Checking this replaces them.` : ""}`
                : canPresent
                  ? `While they're hidden, the "Presented by" line doesn't show either.`
                  : `A hidden sponsor can't present the ${words.kind}. Show them on the public page first.`}
            </span>
          </span>
        </label>
        {editing && (
          <div className="border-t border-border pt-2 sm:hidden">
            <Button type="button" variant="quiet-danger" className="px-0!" onClick={() => onRemove(sponsor!)} disabled={saving}>
              Remove this sponsor
            </Button>
          </div>
        )}
        {tried && Object.keys(errors).length > 0 && (
          <FieldError>
            <span role="alert">
              {capital(listAnd([...new Set(Object.keys(errors).map((k) => FIX[k] ?? "check the boxes outlined in red"))]))}, then try again.
            </span>
          </FieldError>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Window>
  );
}
