import { PilotForm } from "@/app/pilot-form";
import { requestPilot } from "@/app/pilot-actions";
import { Card } from "@/components/ui";
import { brand } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { pilotCta } from "@/lib/pilot";
import { pilotOver } from "@/lib/site-pricing";

/**
 * For someone signed in without an account to host on: every account is set
 * up by our team, so they tell us about their events with the pilot form, or
 * see that we already have their request.
 */
export async function RequestAccess({ email, name }: { email: string; name?: string | null }) {
  // Once the pilot ends, these words lose it (docs/design-decisions/2026-11-22-pricing-page.md).
  const after = pilotOver();
  // Pilot requests are only readable with the server's key.
  const { data: request } = await createAdminClient()
    .from("pilot_requests")
    .select("created_at, status")
    .eq("email", email.toLowerCase())
    .neq("status", "declined")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (request) {
    return (
      <Card className="space-y-3">
        <h2 className="text-xl font-semibold">We have your request</h2>
        <p className="leading-7 text-muted">
          Thanks for {after ? "writing to us" : "asking to join the pilot"} on {formatDate(request.created_at.slice(0, 10), { weekday: undefined })}. Our team sets up
          each account, and we&apos;ll email you at <span className="font-medium text-foreground">{email}</span> when yours is ready.
        </p>
        <p className="text-sm text-muted">
          Questions? Write to{" "}
          <a href={`mailto:${brand.supportEmail}`} className="text-brand underline">
            {brand.supportEmail}
          </a>
          .
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Tell us about your events</h2>
        <p className="leading-7 text-muted">
          Our team sets up each {brand.name} account{after ? "" : " while we're in the pilot"}. Send this, and we&apos;ll email you at{" "}
          <span className="font-medium text-foreground">{email}</span> when yours is ready.
        </p>
      </div>
      <PilotForm action={requestPilot} defaultEmail={email} defaultName={name ?? ""} submitLabel={pilotCta(after)} />
    </Card>
  );
}
