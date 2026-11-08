import type { Metadata } from "next";
import { PublicNav } from "@/components/public-nav";
import { EventBanners } from "@/components/event-banners";
import { FileLinks } from "@/components/file-links";
import { AutoRefresh } from "@/components/auto-refresh";
import { liveVolunteerBanners } from "@/lib/event-banners";
import { filesFor } from "@/lib/event-files";
import { HeaderBar, headerLinkClass } from "@/components/logo";
import Link from "next/link";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { googleCalendarUrl } from "@/lib/ics";
import { formatPhone } from "@/lib/phone";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { formatDate, formatTime, formatTimeRange, utcToZonedDate } from "@/lib/time";
import { icsDownloadUrl } from "@/lib/volunteer-emails";
import { hasPass, readPass } from "@/lib/volunteer-pass";
import { ineligibleReason } from "@/lib/group-signup";
import { cancelMyItem, cancelMyShift, swapMyShift } from "./actions";
import { CancelItemButton, CancelShiftButton, EmailMyLinkForm, ForgetDeviceButton, SwitchShiftForm } from "./forms";

export const metadata: Metadata = { title: "My volunteering" };

type AgendaRow = {
  assignment_id: string;
  manage_token: string;
  event_id: string;
  event_name: string;
  timezone: string;
  venue_name: string | null;
  venue_address: string;
  station_name: string;
  station_location: string | null;
  instructions: string | null;
  shift_title: string;
  shift_description: string | null;
  starts_at: string;
  ends_at: string;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  checked_in_at: string | null;
  volunteer_email: string;
};

type ItemRow = {
  signup_id: string;
  event_id: string;
  event_name: string;
  timezone: string;
  starts_on: string;
  venue_name: string | null;
  venue_address: string;
  station_name: string;
  station_location: string | null;
  instructions: string | null;
  item_name: string;
  note: string | null;
  volunteer_email: string;
};

export default async function MyShiftsPage({ searchParams }: PageProps<"/my">) {
  const { as, link, go } = await searchParams;
  // "as" is the email someone just signed up with (from the confirmation screen).
  const signedUpAs = typeof as === "string" && as.includes("@") ? as.trim().toLowerCase() : undefined;
  const [user, pass] = await Promise.all([getUser(), readPass()]);

  // Shifts come from two places: this device's pass (no login needed) and,
  // for anyone signed in, their account's email. Duplicates are merged.
  const [fromPass, fromAccount, itemsFromPass, itemsFromAccount] = await Promise.all([
    hasPass(pass)
      ? createAdminClient().rpc("pass_agenda", { p_volunteer_tokens: pass.v, p_assignment_tokens: pass.a })
      : Promise.resolve({ data: [] }),
    user ? (await createClient()).rpc("my_agenda") : Promise.resolve({ data: [] }),
    // Items to bring (none before 20261231000000_items_to_bring.sql).
    hasPass(pass)
      ? createAdminClient().rpc("pass_items", { p_volunteer_tokens: pass.v, p_item_tokens: pass.a })
      : Promise.resolve({ data: [] }),
    user ? (await createClient()).rpc("my_items") : Promise.resolve({ data: [] }),
  ]);
  const itemsById = new Map<string, ItemRow>();
  for (const r of [...((itemsFromPass.data ?? []) as ItemRow[]), ...((itemsFromAccount.data ?? []) as ItemRow[])]) {
    itemsById.set(r.signup_id, r);
  }
  // Until the event's first day is over (in its own time zone).
  const items = [...itemsById.values()].filter((r) => r.starts_on >= utcToZonedDate(new Date().toISOString(), r.timezone));
  const itemsByEvent = groupBy(items, (r) => r.event_id);
  const byId = new Map<string, AgendaRow>();
  for (const r of [...((fromPass.data ?? []) as AgendaRow[]), ...((fromAccount.data ?? []) as AgendaRow[])]) {
    byId.set(r.assignment_id, r);
  }
  const rows = [...byId.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const { upcoming, past } = splitByTime(rows);
  const byEvent = groupBy(upcoming, (r) => r.event_id);
  // Events with only items to bring still get their own section.
  const sections = [...new Set([...byEvent.keys(), ...itemsByEvent.keys()])];
  // Maps and documents the host shared with volunteers (or everyone).
  const tzOf = new Map([...items, ...rows].map((r) => [r.event_id, r.timezone]));
  const files = groupBy(
    await filesFor(sections, ["public", "volunteers"], (id) => tzOf.get(id) ?? "America/Chicago"),
    (f) => f.event_id,
  );
  const origin = await getOrigin();
  // Day-of banners from the hosts of the events this person is volunteering at.
  const nameOf = new Map([...items, ...rows].map((r) => [r.event_id, r.event_name]));
  const banners = (await liveVolunteerBanners(sections)).map((b) => ({
    id: b.id,
    body: b.body,
    priority: b.priority,
    time: formatTime(b.created_at, tzOf.get(b.event_id) ?? "America/Chicago"),
    eventName: sections.length > 1 ? nameOf.get(b.event_id) : undefined,
  }));
  const shiftToday = upcoming.some((r) => utcToZonedDate(r.starts_at, r.timezone) === utcToZonedDate(new Date().toISOString(), r.timezone));

  // Events this person volunteers for (or did, before cancelling) that are
  // still taking sign-ups: offer "Sign up for more".
  const knownIds = [...new Set([...rows, ...items].map((r) => r.event_id))];
  const { data: openEvents } =
    knownIds.length || pass.e.length
      ? await (await createClient())
          .from("events")
          .select("id, slug, name")
          .eq("status", "published")
          .eq("volunteer_signup_open", true)
          .or(
            [
              knownIds.length ? `id.in.(${knownIds.join(",")})` : null,
              pass.e.length ? `slug.in.(${pass.e.join(",")})` : null,
            ]
              .filter(Boolean)
              .join(","),
          )
      : { data: [] };
  const signupLinks = new Map((openEvents ?? []).map((e) => [e.id, { slug: e.slug as string, name: e.name as string }]));
  const eventsWithoutShifts = [...signupLinks.entries()].filter(([id]) => !byEvent.has(id) && !itemsByEvent.has(id));

  // Shifts each one could switch to: open spots, allowed for their age, in an event still taking sign-ups (pass holders only).
  const switchable = hasPass(pass) ? upcoming.filter((r) => !r.checked_in_at && signupLinks.has(r.event_id)) : [];
  const switchTo = new Map<string, { id: string; label: string }[]>();
  if (switchable.length) {
    const admin = createAdminClient();
    const [{ data: who }, { data: openShifts }] = await Promise.all([
      admin.from("volunteer_assignments").select("id, volunteer_id, volunteers(minor, age)").in("id", switchable.map((r) => r.assignment_id)),
      admin
        .from("shifts")
        // stations(*): showing arrives with the 20270105000000 update (hidden jobs aren't offered).
        .select("id, event_id, title, starts_at, ends_at, max_capacity, registered_count, adults_only, min_age, stations(*)")
        .in("event_id", [...new Set(switchable.map((r) => r.event_id))])
        .gt("starts_at", new Date().toISOString())
        .order("starts_at"),
    ]);
    type Who = { id: string; volunteer_id: string; volunteers: { minor: boolean; age: number | null } | null };
    const people = new Map(((who ?? []) as unknown as Who[]).map((w) => [w.id, w]));
    const { data: theirs } = await admin
      .from("volunteer_assignments")
      .select("volunteer_id, shift_id")
      .in("volunteer_id", [...new Set([...people.values()].map((w) => w.volunteer_id))]);
    type Open = {
      id: string;
      event_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      max_capacity: number;
      registered_count: number;
      adults_only?: boolean;
      min_age?: number | null;
      stations: { name: string; adults_only: boolean; showing?: boolean } | null;
    };
    for (const r of switchable) {
      const w = people.get(r.assignment_id);
      if (!w) continue;
      const taken = new Set((theirs ?? []).filter((t) => t.volunteer_id === w.volunteer_id).map((t) => t.shift_id as string));
      const options = ((openShifts ?? []) as unknown as Open[])
        .filter((s) => s.event_id === r.event_id && s.stations?.showing !== false && !taken.has(s.id) && s.registered_count < s.max_capacity)
        .filter(
          (s) =>
            !ineligibleReason(
              { minor: Boolean(w.volunteers?.minor), age: w.volunteers?.age ?? null },
              { adultsOnly: Boolean(s.adults_only || s.stations?.adults_only), minAge: s.min_age ?? null },
            ),
        )
        .map((s) => ({
          id: s.id,
          label: `${s.stations?.name ?? s.title}: ${formatDate(utcToZonedDate(s.starts_at, r.timezone), { year: undefined })}, ${formatTimeRange(s.starts_at, s.ends_at, r.timezone)}`,
        }));
      if (options.length) switchTo.set(r.assignment_id, options);
    }
  }

  const mismatch =
    user && signedUpAs && signedUpAs !== user.email.toLowerCase() && ![...rows, ...items].some((r) => r.volunteer_email === signedUpAs)
      ? signedUpAs
      : null;
  const emails = [...new Set([...rows, ...items].map((r) => r.volunteer_email))];

  return (
    <div className="flex flex-1 flex-col">
      <HeaderBar maxWidth="max-w-2xl">
        {/* Volunteers' sign-ups never need signing out of here. */}
        {user ? (
          <PublicNav current="volunteering" />
        ) : (
          <Link href="/login" className={headerLinkClass}>
            Organizer sign in
          </Link>
        )}
      </HeaderBar>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">My volunteering</h1>
        {emails.length > 0 && <p className="mt-1 text-sm text-muted">{emails.join(", ")}</p>}
        {shiftToday && <AutoRefresh status className="mt-1" />}
        {banners.length > 0 && (
          <div className="mt-6">
            <EventBanners banners={banners} />
          </div>
        )}

        {(go === "change" || go === "cancel") && rows.length > 0 && (
          <Card className="mt-6 bg-brand-soft">
            <p className="text-sm">
              {go === "change"
                ? "To change your sign-up, tap “Switch to another time” on the shift below."
                : "To cancel your sign-up, tap “Cancel this shift” on the shift below."}
            </p>
          </Card>
        )}

        {link === "invalid" && (
          <Card className="mt-6 bg-brand-soft">
            <p className="text-sm">That link isn&apos;t valid anymore. Enter your email below and we&apos;ll send a fresh one.</p>
          </Card>
        )}

        {mismatch && (
          <Card className="mt-6 bg-brand-soft">
            <p className="font-medium">You signed up as {mismatch}</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              To see those sign-ups here too, open the confirmation email we sent to {mismatch} and tap its “View or
              cancel my sign-ups” button. You stay signed in as {user!.email}.
            </p>
          </Card>
        )}

        {eventsWithoutShifts.map(([id, ev]) => (
          <Card key={id} className="mt-8">
            <p className="font-medium">{ev.name}</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {sections.length === 0 && rows.length === 0
                ? "You don't have anything signed up right now. Volunteer sign-up is still open."
                : "Volunteer sign-up is still open for this event."}
            </p>
            <SignUpMoreLink slug={ev.slug} primary />
          </Card>
        ))}

        {sections.length === 0 && eventsWithoutShifts.length === 0 && (
          <Card className="mt-8">
            <p className="font-medium">
              {rows.length || user || hasPass(pass) ? "Nothing coming up here" : "Find your sign-ups"}
            </p>
            <p className="mt-1 mb-4 text-sm leading-6 text-muted">
              Enter the email you signed up with and we&apos;ll send you a private link. Tap it on this device and
              we&apos;ll remember you here. No password needed.
            </p>
            <EmailMyLinkForm email={signedUpAs} />
          </Card>
        )}

        {sections.map((eventId) => {
          const shiftRows = byEvent.get(eventId) ?? [];
          const bringing = itemsByEvent.get(eventId) ?? [];
          const head = shiftRows[0] ?? bringing[0];
          const tz = head.timezone;
          const days = groupBy(shiftRows, (r) => utcToZonedDate(r.starts_at, tz));
          return (
            <section key={eventId} className="mt-8">
              <h2 className="text-xl font-semibold">{head.event_name}</h2>
              <p className="text-sm text-muted">
                {[head.venue_name, head.venue_address].filter(Boolean).join(" · ")}
              </p>
              {bringing.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                    What you&apos;re bringing{shiftRows.length ? "" : ` · ${formatDate(bringing[0].starts_on)}`}
                  </h3>
                  <Card className="mt-2 p-0">
                    <ul className="divide-y divide-border">
                      {bringing.map((r) => (
                        <li key={r.signup_id} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium">{r.item_name}</p>
                            <p className="text-sm text-muted">
                              {[r.station_name, r.note, r.station_location && `Drop off: ${r.station_location}`].filter(Boolean).join(" · ")}
                            </p>
                            {r.instructions && <p className="mt-1 text-sm leading-6 text-muted">{r.instructions}</p>}
                          </div>
                          <CancelItemButton action={cancelMyItem.bind(null, r.signup_id)} label={r.item_name} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
              )}
              {[...days.entries()].map(([day, shifts]) => (
                <div key={day} className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{formatDate(day)}</h3>
                  <ul className="mt-2 space-y-3">
                    {shifts.map((r) => (
                      <li key={r.assignment_id}>
                        <ShiftCard row={r} origin={origin} switchTo={switchTo.get(r.assignment_id)} openSwitch={go === "change"} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {files.has(eventId) && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Maps and documents</h3>
                  <FileLinks files={files.get(eventId)!} className="mt-2" />
                </div>
              )}
              {signupLinks.has(eventId) && <SignUpMoreLink slug={signupLinks.get(eventId)!.slug} />}
            </section>
          );
        })}

        {past.length > 0 && (
          <p className="mt-10 text-sm text-muted">
            Plus {past.length} past shift{past.length === 1 ? "" : "s"}. Thank you for helping!
          </p>
        )}

        {hasPass(pass) && rows.length + items.length > 0 && (
          <div className="mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm text-muted">
            <span>This device remembers your sign-ups.</span>
            <ForgetDeviceButton />
          </div>
        )}
      </main>
    </div>
  );
}

function ShiftCard({
  row: r,
  origin,
  switchTo,
  openSwitch,
}: {
  row: AgendaRow;
  origin: string;
  /** Shifts they could switch to instead. */
  switchTo?: { id: string; label: string }[];
  openSwitch?: boolean;
}) {
  const tz = r.timezone;
  const google = googleCalendarUrl({
    timezone: tz,
    start: new Date(r.starts_at),
    end: new Date(r.ends_at),
    summary: `Volunteer: ${r.station_name} (${r.event_name})`,
    location: [r.venue_name, r.venue_address].filter(Boolean).join(", "),
    description: [r.station_location && `Report to: ${r.station_location}`, r.instructions].filter(Boolean).join("\n"),
  });
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-lg font-semibold">{formatTimeRange(r.starts_at, r.ends_at, tz)}</p>
      <p className="mt-0.5 font-medium">
        {r.station_name} · {r.shift_title}
      </p>
      {r.station_location && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Report to:</span> {r.station_location}
        </p>
      )}
      {(r.instructions || r.shift_description) && (
        <p className="mt-2 text-sm leading-6 text-muted">
          {[r.shift_description, r.instructions].filter(Boolean).join(" ")}
        </p>
      )}
      {r.lead_name && (
        <div className="mt-3 rounded-lg bg-background px-3 py-2 text-sm">
          <p>
            <span className="font-medium">Your lead:</span> {r.lead_name}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-4">
            {r.lead_phone && (
              <a href={`tel:${r.lead_phone}`} className="font-medium text-brand underline-offset-4 hover:underline">
                Call {formatPhone(r.lead_phone)}
              </a>
            )}
            {r.lead_phone && (
              <a href={`sms:${r.lead_phone}`} className="font-medium text-brand underline-offset-4 hover:underline">
                Text
              </a>
            )}
            {r.lead_email && (
              <a href={`mailto:${r.lead_email}`} className="font-medium text-brand underline-offset-4 hover:underline">
                Email
              </a>
            )}
          </p>
        </div>
      )}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a href={google} target="_blank" rel="noreferrer" className="font-medium text-brand underline-offset-4 hover:underline">
          Add to Google Calendar
        </a>
        <a href={icsDownloadUrl(origin, r.manage_token)} className="font-medium text-brand underline-offset-4 hover:underline">
          Apple / Outlook calendar
        </a>
      </p>
      <p className="mt-1 text-xs text-muted">
        Tip: the invite in your confirmation email stays up to date automatically; copies added here don&apos;t.
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm text-muted">{r.checked_in_at ? "✓ Checked in" : ""}</span>
        {!r.checked_in_at && <CancelShiftButton action={cancelMyShift.bind(null, r.assignment_id)} label={r.station_name} />}
      </div>
      {switchTo && <SwitchShiftForm action={swapMyShift.bind(null, r.assignment_id)} options={switchTo} open={openSwitch} />}
    </Card>
  );
}

function SignUpMoreLink({ slug, primary = false }: { slug: string; primary?: boolean }) {
  return (
    <Link
      href={`/e/${slug}/volunteer`}
      className={`mt-4 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium ${
        primary ? "bg-brand text-brand-foreground hover:bg-brand-hover" : "border border-brand text-brand hover:bg-brand-soft"
      }`}
    >
      Sign up for more
    </Link>
  );
}

/** Shifts that haven't ended yet vs. ones that have. */
function splitByTime(rows: AgendaRow[]) {
  const now = Date.now();
  const ended = (r: AgendaRow) => new Date(r.ends_at).getTime() < now;
  return { upcoming: rows.filter((r) => !ended(r)), past: rows.filter(ended) };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}
