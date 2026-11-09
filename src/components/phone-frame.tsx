import Image from "next/image";

/**
 * A screenshot inside a simple phone outline (with a lighter edge in dark
 * mode, so it stands out from the dark page). Screenshots live in
 * public/screens/ (390×780 at 2×) and use made-up sample data only.
 */
export function PhoneFrame({
  src,
  alt,
  className = "",
  hero,
}: {
  src: string;
  alt: string;
  className?: string;
  /** At the top of the page, seen first: load it straight away (the "eager" ones), and the main one first ("main"). */
  hero?: "main" | "eager";
}) {
  return (
    <div className={`rounded-[2rem] bg-header p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)] sm:p-2 dark:ring-2 dark:ring-field-border ${className}`}>
      <div className="overflow-hidden rounded-[1.6rem] bg-background">
        <Image
          src={src}
          alt={alt}
          width={780}
          height={1560}
          sizes="(min-width: 1024px) 260px, 45vw"
          className="h-auto w-full"
          // Not lazy at the top of the page: the main screenshot is what phones measure as "loaded" (Largest Contentful Paint).
          {...(hero ? { loading: "eager" as const, fetchPriority: hero === "main" ? ("high" as const) : ("auto" as const) } : {})}
        />
      </div>
    </div>
  );
}
