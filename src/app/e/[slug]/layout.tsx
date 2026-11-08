import Link from "next/link";
import { DemoBar } from "@/components/demo-bar";
import { brand } from "@/lib/brand";
import { brandThemeCss } from "@/lib/brand-color";
import { loadEventBrand } from "@/lib/event-brand";
import { createAdminClient } from "@/lib/supabase/server";

export default async function EventPublicLayout({ children, params }: LayoutProps<"/e/[slug]">) {
  // The account's color re-colors buttons, links, and the event band.
  const { slug } = await params;
  const [{ color }, { data: event }] = await Promise.all([
    loadEventBrand(slug),
    createAdminClient().from("events").select("event_type").eq("slug", slug).maybeSingle(),
  ]);
  // Volunteer events aren't only for schools, so their footer doesn't say so.
  const about =
    event?.event_type === "volunteer"
      ? "volunteer sign-ups and check-in for nonprofits, clubs, and community groups."
      : event?.event_type === "meeting" || event?.event_type === "conference"
        ? "meetings and conferences that book themselves, for schools, clubs, and teams."
        : "sign-ups, schedules, and check-in for bands, choirs, PTOs, and front offices.";
  return (
    <>
      <DemoBar />
      {color ? (
        <div className="event-brand contents">
          <style>{brandThemeCss(".event-brand", color)}</style>
          {children}
        </div>
      ) : (
        children
      )}
      <footer className="mt-auto border-t border-border">
        <p className="mx-auto max-w-3xl px-4 py-6 text-center text-sm text-muted sm:px-6">
          Run with{" "}
          <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
            {brand.name}
          </Link>
          : {about}
        </p>
      </footer>
    </>
  );
}
