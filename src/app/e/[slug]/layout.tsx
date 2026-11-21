import { DemoBar } from "@/components/demo-bar";
import { PublicFooter } from "@/components/public-footer";
import { brandThemeCss } from "@/lib/brand-color";
import { loadEventBrand } from "@/lib/event-brand";

export default async function EventPublicLayout({ children, params }: LayoutProps<"/e/[slug]">) {
  // The account's color re-colors buttons, links, and the event band.
  const { slug } = await params;
  const { color } = await loadEventBrand(slug);
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
      {/* One footer line for every kind (built-page review, 2026-11-21). */}
      <PublicFooter />
    </>
  );
}
