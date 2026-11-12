import "server-only";
import { DEMO_SPONSOR_LOGOS } from "@/lib/demo-sponsor-logos";
import { isSchemaError } from "@/lib/schema-check";
import { processLogoImage, SPONSOR_LOGO_BUCKET } from "@/lib/sponsor-logos";
import { isSponsorKind } from "@/lib/sponsors";
import type { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// Made-up businesses for demo mode (never real ones). Their logos are drawn by
// scripts/make-demo-sponsor-logos.mjs; example.com links go nowhere real.
const LEVELS = ["Gold", "Silver", "Bronze", "Friends"];
const SPONSORS: { name: string; level: number; logo?: string; website?: string; presentedBy?: boolean }[] = [
  { name: "Harbor Lane Credit Union", level: 0, logo: "harbor-lane", website: "https://example.com/harbor-lane", presentedBy: true },
  { name: "Maple & Main Orthodontics", level: 0, logo: "maple-main", website: "https://example.com/maple-and-main" },
  { name: "Bluebird Bakery & Cafe", level: 1, logo: "bluebird", website: "https://example.com/bluebird-bakery" },
  { name: "Riverside Auto Care", level: 1, logo: "riverside-auto", website: "https://example.com/riverside-auto" },
  { name: "Pine Hollow Pizza Co.", level: 1, logo: "pine-hollow" },
  { name: "Summit Music Supply", level: 2, logo: "summit-music", website: "https://example.com/summit-music" },
  { name: "Northgate Hardware", level: 2, logo: "northgate", website: "https://example.com/northgate" },
  { name: "Lakeview Rotary Club", level: 3, website: "https://example.com/lakeview-rotary" },
  { name: "The Okafor Family", level: 3 },
];

/**
 * Sample sponsors for a demoed band contest, festival, or school fair whose account has the Sponsors add-on on
 * (once; never beside the event's own sponsors). Demo mode works without them, so failures are only logged.
 */
export async function seedDemoSponsors(admin: Admin, ownerId: string, eventId: string) {
  const { data: event } = await admin.from("events").select("organization_id, event_type").eq("id", eventId).maybeSingle();
  if (!event || !isSponsorKind(event.event_type)) return;
  const { data: on, error: onError } = await admin.rpc("sponsors_enabled", { p_org: event.organization_id });
  if (onError || !on) return;
  const [{ count: samples }, { count: own }] = await Promise.all([
    admin.from("demo_samples").select("row_id", { count: "exact", head: true }).eq("owner_id", ownerId).eq("event_id", eventId).eq("kind", "sponsor"),
    admin.from("sponsors").select("id", { count: "exact", head: true }).eq("event_id", eventId).is("removed_at", null),
  ]);
  if (samples || own) return;

  const bucket = admin.storage.from(SPONSOR_LOGO_BUCKET);
  const stored: string[] = [];
  const logos = await Promise.all(
    SPONSORS.map(async (s) => {
      const base64 = s.logo ? DEMO_SPONSOR_LOGOS[s.logo] : undefined;
      if (!base64) return null;
      try {
        const out = await processLogoImage(new Uint8Array(Buffer.from(base64, "base64")), s.name);
        const folder = `${event.organization_id}/${eventId}/${crypto.randomUUID()}`;
        const paths = out.files.map((f) => `${folder}/${f.name}`);
        stored.push(...paths);
        const results = await Promise.all(
          out.files.map((f, i) => bucket.upload(paths[i], f.body, { contentType: out.contentType, cacheControl: "31536000", upsert: false })),
        );
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
        return { path: `${folder}/master.${out.ext}`, width: out.width, height: out.height };
      } catch (e) {
        // Shown by name instead.
        console.error("A demo sponsor logo couldn't be stored", e);
        return null;
      }
    }),
  );

  const { data: added, error } = await admin.rpc("demo_seed_sponsors", {
    p_owner: ownerId,
    p_event: eventId,
    p_levels: LEVELS,
    p_sponsors: SPONSORS.map((s, i) => ({
      name: s.name,
      level: s.level,
      website: s.website ?? null,
      logo_path: logos[i]?.path ?? null,
      logo_width: logos[i]?.width ?? null,
      logo_height: logos[i]?.height ?? null,
      presented_by: s.presentedBy ?? false,
    })),
  });
  if (error && !isSchemaError(error)) console.error("demo_seed_sponsors failed", error);
  // Not added (another switch got there first, or the database update isn't run): don't leave the files behind.
  if ((error || !added) && stored.length) await bucket.remove(stored);
}
