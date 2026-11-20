"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";

/** Don't refresh again on wake or focus if the page was just refreshed. */
const MIN_GAP_MS = 5000;

const onConnectionChange = (fn: () => void) => {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
};

/**
 * Keeps an event-day page current without anyone reloading it: re-fetches the
 * page every so often while it's on screen, and right away when a phone wakes
 * up, someone switches back to the tab, or the connection comes back. With
 * `status`, shows when it last updated, or that there's no connection.
 */
export function AutoRefresh({ seconds = 30, status = false, className = "" }: { seconds?: number; status?: boolean; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const online = useSyncExternalStore(onConnectionChange, () => navigator.onLine, () => true);
  const lastRefresh = useRef(0);
  const [wasPending, setWasPending] = useState(false);

  useEffect(() => {
    const refresh = (force: boolean) => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (!force && Date.now() - lastRefresh.current < MIN_GAP_MS) return;
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    };
    const id = setInterval(() => refresh(true), seconds * 1000);
    const onWake = () => refresh(false);
    lastRefresh.current = Date.now();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [router, seconds]);

  // Keep "2 min ago" current.
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [status]);

  // A refresh has finished: the page now shows what's current (to the clock's last tick).
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setUpdatedAt(now);
  }

  if (!status) return null;
  const minutes = Math.floor((Math.max(now, updatedAt) - updatedAt) / 60000);
  const at = new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <p className={`text-xs print:hidden ${online ? "text-muted" : "font-semibold text-danger"} ${className}`}>
      {online ? (
        <>
          <span aria-hidden className="mr-1.5 inline-block size-2 rounded-full bg-success align-middle" />
          Updates on its own · {minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`}
        </>
      ) : (
        `No connection. Showing what loaded at ${at}. This page updates again when you're back online.`
      )}
    </p>
  );
}

/**
 * Refreshes the page once, when a moment on the clock comes (sign-up's opening day starting at midnight in the
 * event's time zone), so every line about it changes together (design lesson L19). Only within the next day:
 * further off, someone reloading the page is enough.
 */
export function RefreshAt({ at }: { at: string }) {
  const router = useRouter();
  useEffect(() => {
    const wait = new Date(at).getTime() - Date.now();
    if (!(wait > 0) || wait > 24 * 60 * 60 * 1000) return;
    // A moment after, so the server's clock has passed it too.
    const t = setTimeout(() => router.refresh(), wait + 2000);
    return () => clearTimeout(t);
  }, [at, router]);
  return null;
}
