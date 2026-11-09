import Image from "next/image";
import Link from "next/link";
import { brand } from "@/lib/brand";

/** The Field Command Events logo. It's white, so always place it on the dark header bar. */
export function Logo({ href = "/", className = "h-11 w-auto sm:h-12" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
      {/* Shown about 72–78 px wide (h-11 / h-12): sized to that, so phones get a small file, not the 640 px one. */}
      <Image src="/logo.png" alt={brand.name} width={78} height={48} preload className={className} />
    </Link>
  );
}

/**
 * Dark bar across the top of a page with the logo, plus optional links on the
 * right. On an event's pages, the account's logo sits beside ours on a white tile.
 */
export function HeaderBar({
  href = "/",
  maxWidth = "max-w-5xl",
  eventLogo,
  children,
}: {
  href?: string;
  maxWidth?: string;
  eventLogo?: { src: string; alt: string } | null;
  children?: React.ReactNode;
}) {
  return (
    <header className="bg-header text-header-foreground">
      <div className={`mx-auto flex ${maxWidth} flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6`}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Logo href={href} />
          {eventLogo && (
            <>
              <span aria-hidden className="h-9 w-px shrink-0 bg-white/35" />
              <span className="flex h-11 min-w-0 items-center rounded-md bg-white px-2 py-1 sm:h-12">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={eventLogo.src} alt={eventLogo.alt} className="max-h-full max-w-[9rem] object-contain sm:max-w-[12rem]" />
              </span>
            </>
          )}
        </div>
        {/* On a narrow phone the links move under the logo rather than overlap it. */}
        {children && <div className="ml-auto flex items-center gap-1 text-sm sm:gap-2">{children}</div>}
      </div>
    </header>
  );
}

/** Link styling for use inside the header bar. */
export const headerLinkClass =
  "min-h-11 content-center whitespace-nowrap rounded-md px-2 text-white/80 hover:text-white dark:text-white sm:px-3";
