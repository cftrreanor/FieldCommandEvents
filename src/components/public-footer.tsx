import Link from "next/link";
import { brand } from "@/lib/brand";

/**
 * The one footer line on every public event page (volunteer, fair, meeting, contest) and organization page: the
 * product's name and its tagline, both from src/lib/brand.ts, so no page has its own version (built-page review,
 * 2026-11-21).
 */
export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <p className="mx-auto max-w-3xl px-4 py-6 text-center text-sm text-muted sm:px-6">
        Run with{" "}
        <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
          {brand.name}
        </Link>
        . {brand.tagline}
      </p>
    </footer>
  );
}
