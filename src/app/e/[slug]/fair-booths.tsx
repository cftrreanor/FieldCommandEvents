import { LineIcon } from "@/components/line-icon";
import type { IconName } from "@/lib/icons";

export type PublicBooth = { id: string; title: string; host_name: string | null; zone: string | null; location: string | null; description: string | null };

const ZONE_ICON: Record<string, IconName> = {
  "game zone": "target",
  "activity stations": "palette",
  marketplace: "bag",
  showcase: "masks",
  "food & drinks": "popcorn",
};

const zoneIcon = (zone: string) => <LineIcon name={ZONE_ICON[zone.toLowerCase()] ?? "sparkle"} className="size-[1.1em]" />;

/** Who hosts the booths, each once: the fair's community partners. */
export const boothHosts = (booths: PublicBooth[]) => [...new Set(booths.map((b) => b.host_name).filter((h): h is string => Boolean(h)))];

/**
 * A fair's public "What's at the event" (public_fair_booths, loaded by the page): booths by zone, with a thank-you
 * to who hosts each one. With sponsors showing, the partners are thanked in the sponsors section instead
 * (`partnersThanked`), and `after` is the day's sponsor line at the end of the list.
 */
export function FairBooths({ booths, partnersThanked = false, after }: { booths: PublicBooth[]; partnersThanked?: boolean; after?: React.ReactNode }) {
  if (booths.length === 0) return null;
  const zones = [...new Set(booths.map((b) => b.zone ?? ""))];
  const hosts = boothHosts(booths);
  return (
    <section id="whats-at-the-event" className="mt-10 scroll-mt-6" aria-labelledby="fair-heading">
      <h2 id="fair-heading" className="text-2xl font-medium tracking-tight">
        What&apos;s at the event
      </h2>
      {zones.length > 1 && (
        <nav aria-label="Fair zones" className="mt-3 flex flex-wrap gap-2">
          {zones.map((zone, i) => (
            <a
              key={zone || "more"}
              href={`#zone-${i}`}
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-3 text-sm font-medium hover:border-brand hover:text-brand"
            >
              <span aria-hidden className="mr-1.5 text-brand">
                {zoneIcon(zone)}
              </span>
              {zone || "And more"}
            </a>
          ))}
        </nav>
      )}
      <div className="mt-6 space-y-10">
        {zones.map((zone, i) => {
          const inZone = booths.filter((b) => (b.zone ?? "") === zone);
          return (
            <section key={zone || "more"} id={`zone-${i}`} aria-labelledby={`zone-${i}-heading`} className="scroll-mt-6">
              <h3 id={`zone-${i}-heading`} className="flex items-baseline gap-2 border-b-2 border-foreground pb-2 text-xl font-semibold">
                <span aria-hidden className="self-center text-brand">{zoneIcon(zone)}</span>
                {zone || "And more"}
                <span className="ml-auto text-sm font-normal text-muted">
                  {inZone.length} {inZone.length === 1 ? "attraction" : "attractions"}
                </span>
              </h3>
              <ul className="divide-y divide-border">
                {inZone.map((b) => (
                  <li key={b.id} className="py-4">
                    <p className="text-lg font-medium leading-7">{b.title}</p>
                    {b.host_name && <p className="text-sm text-muted">Hosted by {b.host_name}</p>}
                    {b.description && <p className="mt-2 leading-6">{b.description}</p>}
                    {b.location && (
                      <p className="mt-2 text-sm">
                        <span className="font-semibold">Where:</span> {b.location}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {hosts.length > 0 && !partnersThanked && (
        <p className="mt-8 rounded-md bg-surface px-4 py-3 text-sm leading-6 text-muted">
          <span className="font-semibold text-foreground">Thank you to our partners:</span> {hosts.join(", ")}.
        </p>
      )}
      {after}
    </section>
  );
}
