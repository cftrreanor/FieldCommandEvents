"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The email as sent, walled off from this page: no scripts run in it and it has no forms. As tall as the email
 * itself (no empty space below a short one, nothing cut off on a phone). Same-origin only so this page can read
 * the email's height; without scripts, the email can't do anything with it.
 */
export function EmailFrame({ title, html }: { title: string; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const measure = () => setHeight(contentHeight(frame.current));
  useEffect(() => {
    // The email may have loaded before this page could listen; and a phone turning sideways reflows it.
    const fit = () => {
      if (frame.current?.contentDocument?.readyState === "complete") setHeight(contentHeight(frame.current));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      onLoad={measure}
      style={height ? { height } : undefined}
      className={`mt-6 w-full rounded-lg border border-border bg-white ${height ? "" : "h-[75vh]"}`}
    />
  );
}

/** The email's own height: the frame is shrunk first, since a page is never shorter than its window. */
function contentHeight(el: HTMLIFrameElement | null) {
  const doc = el?.contentDocument;
  if (!el || !doc?.body) return null;
  const was = el.style.height;
  el.style.height = "0px";
  const h = Math.ceil(doc.documentElement.scrollHeight);
  el.style.height = was;
  return h;
}
