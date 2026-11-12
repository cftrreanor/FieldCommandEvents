"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { brand } from "@/lib/brand";
import { isSchemaError } from "@/lib/schema-check";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { DEMO_COOKIE, PERSONAS, type Persona } from "@/lib/demo";
import { demoAccount } from "@/lib/demo-accounts";
import { seedDemoSponsors } from "@/lib/demo-sponsors";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

const isPersona = (p: string): p is Persona => PERSONAS.some((x) => x.value === p);

const NEEDS_UPDATE =
  "Demo mode needs a database update: run 20261026000000_demo_mode.sql in the Supabase SQL Editor (see docs/SETUP-GUIDE.md), then try again.";

/**
 * Switch this browser to a demo role on an event. A FieldCommand admin can
 * start from their own account (which turns demo mode on for the event); a
 * demo account can switch to its admin's other demo accounts, on events that
 * admin turned demo mode on for.
 */
export async function switchDemo(eventId: string, persona: string): Promise<ActionState> {
  if (!isPersona(persona)) return { error: "Pick a role to view as." };
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: mine } = await admin.from("demo_accounts").select("owner_id").eq("user_id", user.id).maybeSingle();
  let ownerId: string;
  if (mine) {
    ownerId = mine.owner_id;
    const { data: stillAdmin } = await admin.from("platform_admins").select("user_id").eq("user_id", ownerId).maybeSingle();
    if (!stillAdmin) return { error: `Demo mode is only for ${brand.name} admins.` };
    const { data: on } = await admin
      .from("demo_events")
      .select("event_id")
      .eq("owner_id", ownerId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!on) return { error: "Demo mode is off for this event. Go back to your own account to turn it on." };
  } else {
    if (!(await supabase.rpc("is_platform_admin")).data) return { error: `Only ${brand.name} admins can use demo mode.` };
    ownerId = user.id;
    const { error } = await admin
      .from("demo_events")
      .upsert({ owner_id: ownerId, event_id: eventId, last_used_at: new Date().toISOString() });
    if (error) {
      console.error("Turning on demo mode failed", error);
      return { error: isSchemaError(error) ? NEEDS_UPDATE : `We couldn't turn on demo mode for this event. (Details: ${error.code ?? "unknown"}: ${error.message})` };
    }
  }

  // Sample people for the event's type (bands, groups, parents, booths, volunteers), the first time.
  await fillWithSamples(admin, ownerId, eventId);

  const person = await demoAccount(admin, ownerId, persona);
  if (!person) return { error: "We couldn't set up the demo person. Please try again." };
  const { data: bandId, error: joinError } = await admin.rpc("demo_join", {
    p_owner: ownerId,
    p_event: eventId,
    p_user: person.id,
  });
  if (joinError) {
    console.error("demo_join failed", joinError);
    return {
      error: isSchemaError(joinError)
        ? NEEDS_UPDATE
        : joinError.message === "Add a classification to the event first"
          ? "Add at least one classification to the event first (Event settings), so the demo band can register."
          : "We couldn't add the demo person to this event. Please try again.",
    };
  }
  const { data: event } = await admin.from("events").select("slug").eq("id", eventId).single();

  // Sign this browser in as the demo person (no email is sent).
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: person.email });
  if (link.error) {
    console.error("Demo sign-in link failed", link.error);
    return { error: "We couldn't switch to the demo person. Please try again." };
  }
  await supabase.auth.signOut({ scope: "local" });
  const { error: signInError } = await supabase.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (signInError) {
    console.error("Demo sign-in failed", signInError);
    redirect("/login");
  }
  const jar = await cookies();
  jar.set(DEMO_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: DEMO_DAYS * 86400 });
  // Started from the admin's own account: this browser may come straight back to it.
  if (!mine) jar.set(RETURN_COOKIE, signReturn(ownerId), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: DEMO_DAYS * 86400 });

  revalidatePath("/", "layout");
  redirect(
    persona === "parent"
      ? `/e/${event?.slug}`
      : persona === "volunteer"
        ? "/my"
        : persona === "director" && bandId
          ? `/dashboard/bands/${bandId}`
          : `/dashboard/events/${eventId}`,
  );
}

/**
 * Fills a demo event with sample data for its type (once). The admin's demo
 * director "registered" the sample bands. Band contests, festivals, and fairs
 * on accounts with the Sponsors add-on also get sample sponsors. Demo mode
 * still works without it (e.g. before 20261114000000_demo_sample_data.sql is run).
 */
async function fillWithSamples(admin: Admin, ownerId: string, eventId: string) {
  const director = await demoAccount(admin, ownerId, "director");
  const { error } = await admin.rpc("demo_seed", { p_owner: ownerId, p_event: eventId, p_director: director?.id ?? null });
  if (error && !isSchemaError(error)) console.error("demo_seed failed", error);
  await seedDemoSponsors(admin, ownerId, eventId);
}

const DEMO_DAYS = 7;
/** Proof that this browser started the demo from the admin's own account. */
const RETURN_COOKIE = "fc_demo_return";

const signingKey = () => process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
function returnSignature(payload: string) {
  return createHmac("sha256", signingKey() ?? "").update(`demo-return:${payload}`).digest("base64url");
}
function signReturn(ownerId: string) {
  const payload = `${ownerId}.${Date.now() + DEMO_DAYS * 86400_000}`;
  return `${payload}.${returnSignature(payload)}`;
}
/** The admin this browser started the demo as, if its return cookie is genuine and current. */
function returnOwner(cookie: string | undefined): string | null {
  const [ownerId, expires, sig] = (cookie ?? "").split(".");
  if (!ownerId || !expires || !sig || !signingKey() || Number(expires) < Date.now()) return null;
  const want = Buffer.from(returnSignature(`${ownerId}.${expires}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? ownerId : null;
}

/**
 * Leave demo mode. In the browser that started the demo: take the demo people
 * and sample data off the event, sign straight back in as the admin, and open
 * the event. Anywhere else (no proof this browser is the admin's): sign out and
 * email a sign-in link to the admin's own address.
 */
export async function backToMe(): Promise<void> {
  const user = await requireUser();
  const admin = createAdminClient();
  const supabase = await createClient();
  const jar = await cookies();
  const { data: acct } = await admin
    .from("demo_accounts")
    .select("owner_id, profiles!demo_accounts_owner_id_fkey(email)")
    .eq("user_id", user.id)
    .maybeSingle();
  const returning = returnOwner(jar.get(RETURN_COOKIE)?.value);
  await supabase.auth.signOut({ scope: "local" });
  jar.delete(DEMO_COOKIE);
  jar.delete(RETURN_COOKIE);
  const email = (acct?.profiles as unknown as { email: string } | null)?.email;
  if (!acct || !email) redirect("/login");

  const { data: latest } = await admin
    .from("demo_events")
    .select("event_id")
    .eq("owner_id", acct.owner_id)
    .order("last_used_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const eventPage = latest ? `/dashboard/events/${latest.event_id}` : "/dashboard";

  if (returning === acct.owner_id) {
    if (latest) {
      const { error } = await admin.rpc("demo_leave", { p_owner: acct.owner_id, p_event: latest.event_id });
      if (error) console.error("demo_leave failed", error);
    }
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const { error } = link.error
      ? { error: link.error }
      : await supabase.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
    if (!error) {
      revalidatePath("/", "layout");
      redirect(`${eventPage}?demo=ended`);
    }
    console.error("Back-to-me sign-in failed", error);
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await getOrigin()}/auth/callback`, shouldCreateUser: false },
  });
  if (error) {
    console.error("Back-to-me sign-in link failed", { status: error.status, code: error.code, message: error.message });
    redirect(`/login?email=${encodeURIComponent(email)}`);
  }
  // The sign-in link lands back on the event (see /auth/callback).
  if (latest) {
    jar.set("fc_next", eventPage, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60, path: "/" });
  }
  revalidatePath("/", "layout");
  redirect(`/login?email=${encodeURIComponent(email)}&sent=1`);
}

/** Take the demo people back off an event (from the admin's own account). */
export async function endDemo(eventId: string): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await supabase.rpc("is_platform_admin")).data) return { error: `Only ${brand.name} admins can use demo mode.` };
  const { error } = await createAdminClient().rpc("demo_leave", { p_owner: user.id, p_event: eventId });
  if (error) {
    console.error("demo_leave failed", error);
    return { error: "We couldn't remove the demo people. Please try again." };
  }
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  return { ok: true, message: "The demo people and sample data are off this event." };
}
