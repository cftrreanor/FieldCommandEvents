import Link from "next/link";

/** One question. `link`: a page the answer points to, shown after it ("See packages and prices"). */
export type Faq = { q: string; a: string; link?: { href: string; label: string } };

/**
 * Questions that open one at a time to show their answer. Built on
 * <details>, so it works without JavaScript and the answers stay in the
 * page for search engines.
 */
export function FaqList({ faqs }: { faqs: readonly Faq[] }) {
  return (
    <div className="mt-10 max-w-3xl divide-y divide-border border-y border-border">
      {faqs.map((f) => (
        <details key={f.q} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold hover:text-brand [&::-webkit-details-marker]:hidden">
            <span>{f.q}</span>
            <span aria-hidden className="shrink-0 text-xl leading-none text-muted transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="pb-5 pr-8 leading-7 text-muted">
            {f.a}
            {f.link && (
              <>
                {" "}
                <Link href={f.link.href} className="font-medium text-brand underline dark:text-foreground">
                  {f.link.label}
                </Link>
              </>
            )}
          </p>
        </details>
      ))}
    </div>
  );
}
