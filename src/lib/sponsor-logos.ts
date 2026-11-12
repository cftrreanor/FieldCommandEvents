import "server-only";
import sharp, { type Metadata, type Sharp } from "sharp";
import { LOGO, SPONSOR_LOGO_BUCKET, TILE_FILES, logoWarnings } from "@/lib/sponsors";
import type { createAdminClient } from "@/lib/supabase/server";

// Sponsor logos, checked and resized on our server (docs/design-decisions/2026-11-12-sponsors.md): the browser
// uploads to uploads/<event>/<uuid> in the private sponsor-logos bucket with a one-time link; processUpload
// reads it with sharp, refuses what we can't use, and stores the copies the pages serve:
//   <org>/<event>/<version>/master.<ext>   at most 1200 wide (kept for later sizes)
//   <org>/<event>/<version>/t0|t1|t2.<ext> each tile size at 2x
// PNG stays PNG when it has see-through parts; everything else is saved as JPEG. Colors are converted to
// sRGB and every bit of metadata (EXIF, location, camera) is dropped.

export { SPONSOR_LOGO_BUCKET };

type Admin = ReturnType<typeof createAdminClient>;

export type ProcessedLogo = {
  /** The master's path, for save_sponsor's p_logo_path. */
  path: string;
  version: string;
  /** The uploaded image's real size, upright. */
  width: number;
  height: number;
  warnings: { small: boolean; tall: boolean };
};

/** Words for the organizer: what's wrong with the file and how to fix it, as sentences. */
export class LogoError extends Error {}

/** "It's 7.4 MB, over the 5 MB limit. …" (shown after the file's name). */
export const tooBigMessage = (bytes: number, who = "the sponsor") =>
  `It's ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${LOGO.maxMB} MB limit. Save it smaller, or ask ${who} for a PNG or JPG under ${LOGO.maxMB} MB.`;
/** "It's 8,000 × 6,000 pixels, too big to open. …" (both sides, so the fix is clear). */
export const tooManyPixelsMessage = (width: number, height: number) =>
  `It's ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} pixels, too big to open. Save it at ${LOGO.maxSide[0].toLocaleString("en-US")} × ${LOGO.maxSide[1].toLocaleString("en-US")} pixels or smaller, then upload it again.`;
export const notImageMessage = (who = "the sponsor") => `It isn't a PNG or JPG, so it can't show on a web page. Ask ${who} for a PNG or JPG.`;

/** What the file really is, from its first bytes (not its name or the type the browser claimed). */
export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a)
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/** The uploaded file's folder for an event: uploads go here first, and the daily job sweeps what's left a day later. */
export const uploadFolder = (eventId: string) => `uploads/${eventId}/`;

/**
 * Check and resize one image. Throws LogoError with words for the organizer when it can't be used (`who`: the
 * sponsor's name, for "Ask … for"). Returns the files to store (by name) and the image's real size.
 */
export async function processLogoImage(input: Uint8Array, who = "the sponsor") {
  if (input.byteLength > LOGO.maxBytes) throw new LogoError(tooBigMessage(input.byteLength, who));
  const kind = sniffImage(input);
  if (!kind) throw new LogoError(notImageMessage(who));
  let meta: Metadata;
  try {
    // Only the header is read here, so the pixel cap can be checked before anything is decoded.
    meta = await sharp(input, { failOn: "error" }).metadata();
  } catch {
    throw new LogoError("We couldn't read this image. Save it again as a PNG or JPG, then upload it again.");
  }
  if (meta.format !== kind) throw new LogoError(notImageMessage(who));
  if (!meta.width || !meta.height) throw new LogoError("We couldn't read this image. Save it again as a PNG or JPG, then upload it again.");
  if (meta.width * meta.height > LOGO.maxPixels) throw new LogoError(tooManyPixelsMessage(meta.width, meta.height));
  // autoOrient: metadata reports the upright size.
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (width < LOGO.refuseUnder)
    throw new LogoError(
      `It's ${width} pixels wide, and we can't use logos under ${LOGO.refuseUnder}. Ask ${who} for one ${LOGO.minWidth} pixels wide or more.`,
    );

  const alpha = kind === "png" && Boolean(meta.hasAlpha);
  const ext = alpha ? "png" : "jpg";
  const encode = (img: Sharp) =>
    (alpha ? img.png({ compressionLevel: 9, adaptiveFiltering: true }) : img.flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true }))
      .toColourspace("srgb")
      .toBuffer();

  let files: { name: string; body: Buffer }[];
  try {
    // Decode the upload once, into the master (at most 1200 wide, upright, sRGB) as raw pixels; every tile size is
    // made from that master, never from the upload again.
    const { data, info } = await sharp(input, { limitInputPixels: LOGO.maxPixels, failOn: "error", autoOrient: true })
      .resize({ width: LOGO.resizeTo, withoutEnlargement: true })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const fromMaster = () => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    files = [{ name: `master.${ext}`, body: await encode(fromMaster()) }];
    for (const t of TILE_FILES) {
      files.push({ name: `${t.file}.${ext}`, body: await encode(fromMaster().resize({ width: t.w, height: t.h, fit: "inside", withoutEnlargement: true })) });
    }
  } catch {
    throw new LogoError("We couldn't read this image. Save it again as a PNG or JPG, then upload it again.");
  }
  return { ext, width, height, files, contentType: alpha ? "image/png" : "image/jpeg" };
}

/**
 * After the browser's upload: read uploads/<event>/<file>, check and resize it, store the copies in the event's
 * folder, and delete the upload. The caller has checked the person may change this event's sponsors.
 */
export async function processUpload(admin: Admin, org: string, eventId: string, uploadPath: string, who = "the sponsor"): Promise<ProcessedLogo> {
  if (!uploadPath.startsWith(uploadFolder(eventId)) || uploadPath.includes("..") || uploadPath.split("/").length !== 3)
    throw new LogoError("That upload isn't for this event. Upload the logo again.");
  const bucket = admin.storage.from(SPONSOR_LOGO_BUCKET);
  const { data: blob, error } = await bucket.download(uploadPath);
  if (error || !blob) throw new LogoError("We couldn't find the upload. Upload the logo again.");
  try {
    const out = await processLogoImage(new Uint8Array(await blob.arrayBuffer()), who);
    const version = crypto.randomUUID();
    const folder = `${org}/${eventId}/${version}`;
    for (const f of out.files) {
      const { error: putError } = await bucket.upload(`${folder}/${f.name}`, f.body, { contentType: out.contentType, cacheControl: "31536000", upsert: false });
      if (putError) {
        console.error("Storing a sponsor logo failed", putError);
        await bucket.remove(out.files.map((x) => `${folder}/${x.name}`));
        throw new LogoError("We couldn't save the logo. Check your connection, then upload it again.");
      }
    }
    return { path: `${folder}/master.${out.ext}`, version, width: out.width, height: out.height, warnings: logoWarnings(out.width, out.height) };
  } finally {
    await bucket.remove([uploadPath]);
  }
}

/** Copy a logo's files (master and tiles) from one stored path to another (reuse). False if any copy failed. */
export async function copyLogoFiles(admin: Admin, fromMaster: string, toMaster: string) {
  const bucket = admin.storage.from(SPONSOR_LOGO_BUCKET);
  const ext = fromMaster.split(".").pop();
  const fromDir = fromMaster.slice(0, fromMaster.lastIndexOf("/"));
  const toDir = toMaster.slice(0, toMaster.lastIndexOf("/"));
  const names = ["master", ...TILE_FILES.map((t) => t.file)].map((n) => `${n}.${ext}`);
  const results = await Promise.all(names.map((n) => bucket.copy(`${fromDir}/${n}`, `${toDir}/${n}`)));
  const failed = results.find((r) => r.error);
  if (failed) {
    console.error("Copying a sponsor logo failed", failed.error);
    await bucket.remove(names.map((n) => `${toDir}/${n}`));
    return false;
  }
  return true;
}

/** One stored file (a tile or the master) beside a master path, or null. */
export async function downloadLogoFile(admin: Admin, masterPath: string, file: string) {
  const ext = masterPath.split(".").pop();
  const path = `${masterPath.slice(0, masterPath.lastIndexOf("/"))}/${file}.${ext}`;
  const { data } = await admin.storage.from(SPONSOR_LOGO_BUCKET).download(path);
  if (!data) return null;
  return { body: await data.arrayBuffer(), type: ext === "png" ? "image/png" : "image/jpeg" };
}
