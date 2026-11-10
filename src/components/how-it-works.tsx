import { PhoneFrame } from "@/components/phone-frame";

/** One step: what happens, and a phone screenshot of it (public/screens/, sample data only). */
export type HowStep = { title: string; body: string; screen: string; alt: string };

// Every step is in view at every width (no sideways row to swipe): on phones each step is a row with a small
// screenshot beside its words, so three steps stay short; wider screens put the steps side by side.
const columns = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" } as const;

/** "How it works": numbered steps, each with the real screen in a phone outline. `className` replaces the top border. */
export function HowItWorks({ steps, className = "border-t border-border" }: { steps: HowStep[]; className?: string }) {
  const cols = columns[steps.length === 3 ? 3 : 4];
  return (
    <section id="how" tabIndex={-1} className={`scroll-mt-20 outline-none ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-normal leading-[1.02] tracking-tight sm:text-4xl">How it works</h2>
        <ol aria-label="How it works, step by step" className={`mt-8 grid gap-8 sm:gap-6 ${cols}`}>
          {steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[1fr_7.5rem] items-start gap-4 sm:flex sm:flex-col sm:gap-0">
              <div className="sm:flex-1">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="mt-1 leading-7 text-muted">{s.body}</p>
              </div>
              <PhoneFrame
                src={s.screen}
                alt={s.alt}
                sizes="(min-width: 640px) 240px, 108px"
                className="w-full sm:mt-6 sm:max-w-[260px]"
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
