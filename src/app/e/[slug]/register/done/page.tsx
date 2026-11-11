import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EventHeaderBar } from "@/components/event-brand";
import { Card } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Registered", robots: { index: false } };

/** After registering a group for a festival (board 16, right): proof it's handled, and what happens next. */
export default async function RegisteredPage({ params, searchParams }: PageProps<"/e/[slug]/register/done">) {
  const { slug } = await params;
  const { g } = await searchParams;
  const user = await getUser();
  if (!user || typeof g !== "string") redirect(`/e/${slug}/register`);
  const supabase = await createClient();
  const { data: band } = await supabase
    .from("bands")
    .select("id, band_name, events(band_registration_deadline, performance_order_published)")
    .eq("id", g)
    .eq("director_user_id", user.id)
    .maybeSingle();
  if (!band) redirect(`/e/${slug}/register`);
  const ev = band.events as unknown as { band_registration_deadline: string | null; performance_order_published: boolean } | null;
  const deadline = ev?.band_registration_deadline ?? null;
  const when = ev?.performance_order_published
    ? "Your times come by email once the organizer adds your group to the schedule."
    : `Your times come by email once the organizer posts the schedule${deadline ? `, after registration closes ${formatDate(deadline)}` : ""}.`;

  return (
    <>
      <EventHeaderBar slug={slug} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
        <Card className="border-l-4 border-l-success" role="status">
          <h1 className="text-2xl font-semibold">
            <span aria-hidden className="text-success">
              ✓{" "}
            </span>
            {band.band_name} is registered
          </h1>
          <p className="mt-2 text-sm leading-6">
            We emailed a copy to <span className="break-all">{user.email}</span>. {when}
          </p>
          <p className="mt-2 text-sm leading-6">
            You can change your answers {deadline ? `until registration closes ${formatDate(deadline)}` : "while registration is open"}.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/dashboard/bands/${band.id}`} className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground hover:bg-brand-hover">
              See your group&apos;s page
            </Link>
            <Link href={`/e/${slug}/register`} className="inline-flex min-h-11 items-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand">
              Register another group
            </Link>
          </div>
        </Card>
      </main>
    </>
  );
}
