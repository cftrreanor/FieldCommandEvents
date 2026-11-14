import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { EventHeaderBar } from "@/components/event-brand";
import { SubmitButton } from "@/components/submit-button";
import { Card } from "@/components/ui";
import { GRADES } from "@/lib/grades";
import { createAdminClient } from "@/lib/supabase/server";
import { googleCalendarUrl } from "@/lib/ics";
import { ADULTS, ID_REMINDER, otherAdultNames, sortedAdults, parentLink, parentRegistrationClosed, toIcsEvent, type Child } from "@/lib/parents";
import { formatDateRange, formatTimeRange } from "@/lib/time";
import { getOrigin } from "@/lib/data";
import { cancelParents, updateParents } from "../../actions";
import { ParentsForm } from "../../parents-form";
import { LineIcon } from "@/components/line-icon";

export const metadata: Metadata = { title: "Your registration" };

/** The link in a parent's confirmation email: see the registration, change it, or cancel it. */
export default async function ParentRegistrationLinkPage({ params }: PageProps<"/e/[slug]/parents/r/[token]">) {
  const { slug, token } = await params;
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const admin = createAdminClient();
  const { data: reg } = valid
    ? await admin
        .from("parent_registrations")
        .select(`id, event_id, parent_name, email, phone, children, calendar_sequence, ${ADULTS}`)
        .eq("access_token", token)
        .maybeSingle()
    : { data: null };
  const { data: event } = reg
    ? await admin
        .from("events")
        .select("slug, name, status, starts_on, ends_on, window_start, window_end, timezone, venue_name, venue_address, parent_registration_open, parent_registration_closes_at")
        .eq("id", reg.event_id)
        .maybeSingle()
    : { data: null };
  const children = (reg?.children ?? []) as Child[];
  const others = otherAdultNames(reg?.adults);
  // Anyone on the registration checked in at the door.
  const checkedIn = sortedAdults(reg?.adults).some((a) => a.checked_in_at);
  const calendar =
    reg && event
      ? googleCalendarUrl(
          toIcsEvent({ ...reg, children, other_adults: others }, event, parentLink(await getOrigin(), slug, token)),
        )
      : null;
  const linkClass = "inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline";

  return (
    <>
      <EventHeaderBar slug={slug} maxWidth="max-w-md" />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-12">
        {!reg || !event || event.slug !== slug ? (
          <Card>
            <h1 className="text-2xl font-medium">This link isn&apos;t valid</h1>
            <p className="mt-2 text-muted">The registration may have been canceled, or deleted after the event.</p>
            <Link
              href={`/e/${slug}/parents`}
              className="mt-4 inline-flex min-h-11 items-center font-medium text-brand underline-offset-4 hover:underline"
            >
              Go to parent registration
            </Link>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <p className="text-sm font-medium text-muted">You&apos;re registered</p>
              <h1 className="mt-1 text-3xl font-medium">{event.name}</h1>
              <p className="mt-2 text-muted">
                {formatDateRange(event.starts_on, event.ends_on)} · {formatTimeRange(event.window_start, event.window_end, event.timezone)}
              </p>
              <p className="mt-1 text-muted">{[event.venue_name, event.venue_address].filter(Boolean).join(" · ")}</p>

              <dl className="mt-5 space-y-1 text-sm">
                <div>
                  <dt className="inline text-muted">Parent: </dt>
                  <dd className="inline font-medium">{reg.parent_name}</dd>
                </div>
                {others.length > 0 && (
                  <div>
                    <dt className="inline text-muted">Also coming: </dt>
                    <dd className="inline">{others.join(", ")}</dd>
                  </div>
                )}
                <div>
                  <dt className="inline text-muted">Email: </dt>
                  <dd className="inline">{reg.email}</dd>
                </div>
              </dl>
              <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                {children.map((c, i) => (
                  <li key={i} className="px-3 py-2">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-muted">
                      {c.grade} · {c.teacher}
                    </p>
                  </li>
                ))}
              </ul>
              {checkedIn && <p className="mt-3 text-sm font-medium text-success">✓ Checked in</p>}
              {calendar && !checkedIn && (
                <p className="mt-3 flex flex-wrap items-center gap-x-4 text-sm">
                  <span className="text-muted">Add to calendar:</span>
                  <a href={calendar} target="_blank" rel="noreferrer" className={linkClass}>
                    Google
                  </a>
                  <a href={`/e/${slug}/parents/r/${token}/calendar`} className={linkClass}>
                    Apple / Outlook
                  </a>
                </p>
              )}
            </Card>

            <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 font-medium"><LineIcon name="id" inline />{ID_REMINDER}</p>

            <Card>
              {event && !parentRegistrationClosed(event) ? (
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover group-open:bg-transparent group-open:justify-start group-open:px-0 group-open:text-lg group-open:text-foreground">
                    Change my registration
                  </summary>
                  <div className="mt-4">
                    <ParentsForm
                      action={updateParents.bind(null, token)}
                      grades={GRADES}
                      idReminder={ID_REMINDER}
                      initial={{
                        parentName: reg.parent_name,
                        email: reg.email,
                        phone: reg.phone ?? "",
                        otherAdults: others,
                        children,
                      }}
                    />
                  </div>
                </details>
              ) : (
                <p className="text-sm leading-6 text-muted">Registration is closed, so changes can&apos;t be made online. Contact the school.</p>
              )}
              {!checkedIn && (
                <ActionForm
                  action={cancelParents.bind(null, token)}
                  confirmMessage="Cancel this registration?"
                  className="mt-3 text-center"
                >
                  <SubmitButton variant="quiet-danger" pendingText="Canceling…">
                    Cancel my registration
                  </SubmitButton>
                </ActionForm>
              )}
            </Card>
          </div>
        )}
      </main>
    </>
  );
}
