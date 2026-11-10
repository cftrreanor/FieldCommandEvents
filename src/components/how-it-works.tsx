import { PhoneFrame } from "@/components/phone-frame";

/** One step: what happens, and a phone screenshot of it (public/screens/, sample data only). */
export type HowStep = { title: string; body: string; screen: string; alt: string };

// Every step is in view at every width (no sideways row to swipe). On phones the steps are words only: a
// screenshot that small can't be read, and the bigger ones further down the page show the same screens.
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
            <li key={s.title} className="flex flex-col">
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
                sizes="240px"
                className="mt-6 hidden w-full max-w-[260px] sm:block"
              />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
