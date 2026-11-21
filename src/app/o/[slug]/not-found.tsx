import type { Metadata } from "next";
import Link from "next/link";
import { HeaderBar } from "@/components/logo";
import { PublicNav } from "@/components/public-nav";
import { OrgFooter } from "./parts";

export const metadata: Metadata = { title: "This page isn't available", robots: { index: false, follow: false } };

/**
 * An organization page that's off (or was never on, or the account can't have one): nothing about the group, a way
 * to the visitor's own sign-ups, and a word that a link to one event still works.
 */
export default function OrgPageUnavailable() {
  return (
    <>
      <HeaderBar maxWidth="max-w-2xl">
        <PublicNav />
      </HeaderBar>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">
        <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">This page isn&apos;t available</h1>
        <p className="mt-4 leading-7">If someone sent you a link to one event, that link still works.</p>
        <p className="mt-4">
          <Link href="/my" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
            Go to My volunteering
          </Link>
        </p>
      </main>
      <OrgFooter />
    </>
  );
}
