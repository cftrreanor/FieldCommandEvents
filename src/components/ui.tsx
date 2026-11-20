import type { ComponentProps, ReactNode } from "react";
import { SuccessToast } from "./toaster";

// Small shared building blocks so every form looks and behaves the same.
// Sizes favor touch: contest-day users are on phones, often outdoors.

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "accent" | "go" | "danger" | "warn" | "ghost" | "quiet-danger" }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
        variant === "primary" && "bg-brand font-semibold text-brand-foreground hover:bg-brand-hover",
        // Outline at 3:1 or more against the page in both themes, so the button's edge shows outdoors.
        variant === "secondary" && "border border-field-border bg-surface hover:border-brand hover:bg-background",
        variant === "accent" && "bg-accent font-semibold text-accent-foreground hover:brightness-90",
        variant === "go" && "bg-success font-semibold text-success-foreground shadow-sm hover:shadow-md hover:brightness-90",
        variant === "warn" && "bg-danger font-semibold text-danger-foreground shadow-sm hover:shadow-md hover:brightness-90",
        variant === "danger" && "border border-danger bg-surface font-semibold text-danger hover:bg-danger/5",
        variant === "ghost" && "text-muted hover:text-foreground",
        // A destructive action that shouldn't compete with the main one.
        variant === "quiet-danger" && "text-danger underline-offset-4 hover:underline",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  errorId,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  /** A problem with this answer, shown in red under the field. Point the input's aria-describedby at errorId. */
  error?: string;
  errorId?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      {/* data-field-label: where a required answer's asterisk goes (globals.css). */}
      <span data-field-label className="text-sm font-semibold">
        {label}
      </span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </label>
  );
}

/** A problem with one answer, in red under its field. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-sm font-semibold text-danger">
      {children}
    </span>
  );
}

const inputClass =
  "min-h-11 w-full rounded-sm border border-field-border bg-surface px-3 text-base outline-none transition focus:border-brand focus:ring-[3px] focus:ring-brand/25 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputClass, "min-h-24 py-2", className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6", className)} {...props} />;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  /** live: solid green, for open or published. off: solid red, only for something that was withdrawn. A normal closed or not-yet state is neutral. */
  tone?: "neutral" | "info" | "accent" | "brand" | "success" | "warning" | "live" | "off";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tone === "neutral" && "bg-background text-muted ring-1 ring-border",
        tone === "info" && "bg-brand-soft text-foreground ring-1 ring-brand/25",
        tone === "accent" && "bg-accent-soft text-foreground ring-1 ring-accent/30",
        tone === "brand" && "bg-brand text-brand-foreground",
        tone === "success" && "bg-success-soft text-foreground ring-1 ring-success/30",
        tone === "warning" && "bg-warning-soft text-foreground ring-1 ring-warning/30",
        tone === "live" && "bg-success text-success-foreground",
        tone === "off" && "bg-danger text-danger-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function FormMessage({ error, success, link }: { error?: string | null; success?: string | null; link?: { href: string; label: string } }) {
  if (error) {
    return (
      <p role="alert" tabIndex={-1} data-form-message className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
        {error}
        {link && (
          <>
            {" "}
            <a href={link.href} className="font-semibold text-brand underline underline-offset-4">
              {link.label}
            </a>
          </>
        )}
      </p>
    );
  }
  // Success messages appear as a toast in the top-right corner (components/toaster).
  if (success) return <SuccessToast message={success} />;
  return null;
}
