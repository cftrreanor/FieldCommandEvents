import Link from "next/link";
import { IconTile, LineIcon } from "@/components/line-icon";
import { Badge, Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import {
  OPEN_MONTHS,
  byMonth,
  dayNum,
  dayWords,
  isItemsOnly,
  isToday,
  kindWords,
  monthShort,
  needWords,
  plural,
  shortDay,
  shownOn,
  signupHref,
  siteOf,
  whenWords,
  type OrgHelp,
  type OrgListingEvent,
} from "@/lib/org-page";

export const BTN_OUTLINE =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";
export const LINK = "font-semibold text-brand underline underline-offset-4";
const CHIP = "inline-flex min-h-11 items-center rounded-full border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/** What the page knows about each event's shifts beyond the listing: when they run, and the one open shift if only one. */
export type ShiftFacts = { range: { start: string; end: string } | null; onlyOpenShift: string | null };

/** The group's logo on its white tile (readable in dark mode), never stretched. */
export function LogoTile({ src, name }: { src: string; name: string }) {
  return (
    <span className="inline-flex h-16 max-w-full shrink-0 items-center self-start rounded-md bg-white px-2 py-1 sm:h-20 sm:self-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} logo`} className="max-h-full w-auto max-w-[14rem] object-contain" />
    </span>
  );
}

export function OrgHeading({ name, logo, band }: { name: string; logo: string | null; band: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
      {logo && <LogoTile src={logo} name={name} />}
      <div className="min-w-0">
        <h1 className="text-4xl font-medium tracking-tight [overflow-wrap:anywhere] sm:text-5xl">{name}</h1>
        <p className={`mt-2 ${band ? "" : "text-muted"}`}>Events and ways to help from {name}</p>
      </div>
    </div>
  );
}

function DateTile({ iso }: { iso: string }) {
  return (
    <span aria-hidden className="flex w-14 shrink-0 flex-col items-center self-start rounded-md border border-border bg-background py-1.5 leading-none">
      <span className="text-xs font-semibold uppercase">{monthShort(iso)}</span>
      <span className="mt-1 text-2xl font-medium tabular-nums">{dayNum(iso)}</span>
    </span>
  );
}

function EventRow({ e, facts }: { e: OrgListingEvent; facts?: ShiftFacts }) {
  const k = kindWords(e);
  const today = isToday(e);
  const on = shownOn(e);
  const when = whenWords(e, facts?.range ?? null);
  const href = e.opens_on
    ? signupHref(e.slug, "org")
    : `${signupHref(e.slug, "org", facts?.onlyOpenShift)}${isItemsOnly(e) ? "#pick" : ""}`;
  return (
    <li className="flex gap-3 px-4 py-4 sm:gap-4">
      <DateTile iso={on} />
      <div className="min-w-0 flex-1">
        {today && (
          <p className="mb-1">
            <Badge tone="info">Today</Badge>
          </p>
        )}
        <h4 className="text-lg leading-6 font-semibold [overflow-wrap:anywhere]">{e.name}</h4>
        <p className="mt-1 flex items-center gap-1.5 text-sm">
          <LineIcon name={k.icon} className="size-4" />
          {k.word}
        </p>
        {when && <p className="mt-1 text-sm">{when}</p>}
        {e.venue_name && <p className="text-sm text-muted [overflow-wrap:anywhere]">{e.venue_name}</p>}
        <p className="mt-2 text-sm font-semibold">{e.opens_on ? `Volunteer sign-up opens ${dayWords(e.opens_on)}` : needWords(e)}</p>
        <Link href={href} className={`${BTN_OUTLINE} mt-3`}>
          {e.opens_on ? "See the event" : k.button}
          <span className="sr-only">
            {" "}
            for {e.name}, {shortDay(on)}
          </span>
        </Link>
      </div>
    </li>
  );
}

function HelpRow({ h }: { h: OrgHelp }) {
  const site = h.link ? siteOf(h.link) : null;
  return (
    <li className="flex gap-3 px-4 py-4 sm:gap-4">
      <IconTile name="sparkle" size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold [overflow-wrap:anywhere]">{h.title}</h3>
        {h.note && <p className="mt-1 text-sm leading-6 [overflow-wrap:anywhere]">{h.note}</p>}
        <p className="mt-1 text-sm text-muted">Until {dayWords(h.ends_on)}</p>
        {h.link && site && (
          <p className="mt-2">
            <a href={h.link} target="_blank" rel="noopener noreferrer" className={BTN_OUTLINE}>
              Open on {site}
              <span className="sr-only"> for {h.title}, in a new tab</span>
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

const Chevron = () => (
  <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Contact({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <>
      Questions? Email{" "}
      <a href={`mailto:${email}`} className={`${LINK} [overflow-wrap:anywhere]`}>
        {email}
      </a>
    </>
  );
}

/**
 * The page's body: Coming up by month first, then Help anytime, then the contact. Two chips at the top jump to each.
 * Only months with events show; the first two are open and later ones are folded rows that open when tapped
 * (owner, 2026-11-21). `allFull`: the page has events, but every spot is taken right now.
 */
export function OrgBody({
  name,
  contact,
  events,
  help,
  facts,
  allFull,
}: {
  name: string;
  contact: string | null;
  events: OrgListingEvent[];
  help: OrgHelp[];
  facts: Map<string, ShiftFacts>;
  allFull: boolean;
}) {
  if (!events.length && !help.length && !allFull) {
    return (
      <Card className="mt-8">
        <h2 className="text-xl font-semibold">Nothing&apos;s coming up right now</h2>
        <p className="mt-2 leading-7">When {name} adds an event or a way to help, it shows here.</p>
        {contact && (
          <p className="mt-2 leading-7">
            <Contact email={contact} />
          </p>
        )}
      </Card>
    );
  }
  const months = byMonth(events);
  const open = months.slice(0, OPEN_MONTHS);
  const folded = months.slice(OPEN_MONTHS);
  return (
    <div className="mt-8 space-y-10">
      {events.length > 0 && help.length > 0 && (
        <nav aria-label="On this page" className="flex flex-wrap gap-2">
          <a href="#coming" className={CHIP}>
            Coming up · {events.length}
          </a>
          <a href="#help" className={CHIP}>
            Help anytime · {help.length}
          </a>
        </nav>
      )}
      {allFull && (
        <Card>
          <h2 className="text-xl font-semibold">Every spot is taken right now.</h2>
          <p className="mt-2 leading-7">When a spot opens or {name} adds an event, it shows here.</p>
        </Card>
      )}
      {events.length > 0 && (
        <section id="coming" aria-labelledby="coming-title" className="scroll-mt-6">
          <h2 id="coming-title" className="text-2xl font-semibold">
            Coming up
          </h2>
          {events.length === 1 ? (
            <ul className="mt-4 rounded-lg border border-border bg-surface">
              <EventRow e={events[0]} facts={facts.get(events[0].slug)} />
            </ul>
          ) : (
            <>
              {open.map((m) => (
                <div key={m.key} className="mt-5">
                  <h3 className="text-lg font-semibold">{m.label}</h3>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                    {m.events.map((e) => (
                      <EventRow key={e.slug} e={e} facts={facts.get(e.slug)} />
                    ))}
                  </ul>
                </div>
              ))}
              {folded.length > 0 && (
                <ul className="mt-5 divide-y divide-border rounded-lg border border-border bg-surface">
                  {folded.map((m) => (
                    <li key={m.key}>
                      <details className="group">
                        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold">{m.label}</span>
                            <span className="text-muted"> · {plural(m.events.length, "event", "events")}</span>
                          </span>
                          <Chevron />
                        </summary>
                        <ul className="divide-y divide-border border-t border-border">
                          {m.events.map((e) => (
                            <EventRow key={e.slug} e={e} facts={facts.get(e.slug)} />
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      {help.length > 0 && (
        <section id="help" aria-labelledby="help-title" className="scroll-mt-6">
          <h2 id="help-title" className="text-2xl font-semibold">
            Help anytime
          </h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {help.map((h) => (
              <HelpRow key={h.id} h={h} />
            ))}
          </ul>
          {help.some((h) => h.link) && <p className="mt-2 text-sm text-muted">Links open other websites. {brand.name} never handles money or donations.</p>}
        </section>
      )}
      {contact && (
        <p className="text-sm leading-6 text-muted">
          <Contact email={contact} />
        </p>
      )}
    </div>
  );
}

/** The organization page's footer: words that fit any group. */
export function OrgFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <p className="mx-auto max-w-2xl px-4 py-6 text-center text-sm text-muted sm:px-6">
        Run with{" "}
        <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
          {brand.name}
        </Link>
        : volunteer sign-ups and check-in for schools, PTOs, clubs, and community groups
      </p>
    </footer>
  );
}
