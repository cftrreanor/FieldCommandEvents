"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmDialog } from "@/components/confirm-dialog";
import { CopyLink } from "@/components/copy-link";
import { Button } from "@/components/ui";
import { doorLinkOff, newDoorLink } from "../../actions";

const OUT = "inline-flex min-h-11 items-center justify-center rounded-md border border-field-border bg-surface px-4 text-sm font-semibold hover:border-brand";

/**
 * "Door link for [room]" (hosts and co-hosts): a private link for whoever is at the room's door, with no sign-in.
 * It marks groups in this room only, until it's turned off or a new one replaces it.
 */
export function DoorLink({
  eventId,
  roomId,
  roomName,
  door,
  posted,
  until,
  expired,
}: {
  eventId: string;
  roomId: string;
  roomName: string;
  door: { url: string; qr: string; on: boolean } | null;
  posted: boolean;
  /** The last day it works ("Sunday, March 22"): the day after the festival. */
  until: string;
  expired: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"new" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = (door?.on ?? false) && !expired;

  const make = async () => {
    if (live) {
      const ok = await confirmDialog({
        title: "Make a new door link?",
        message: `The link you have now stops working right away. Anyone using it at ${roomName}'s door needs the new one.`,
        confirmLabel: "Make a new link",
        cancelLabel: "Keep this link",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy("new");
    setError(null);
    const r = await newDoorLink(eventId, roomId).catch(() => ({ error: "Check your connection, then try again." }));
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  };
  const off = async () => {
    const ok = await confirmDialog({
      title: "Turn off this door link?",
      message: `It stops working right away, so no one can mark groups in ${roomName} with it. Your team can still mark them on Event day, and you can make a new link.`,
      confirmLabel: "Turn off this link",
      cancelLabel: "Keep it on",
      danger: true,
    });
    if (!ok) return;
    setBusy("off");
    setError(null);
    const r = await doorLinkOff(eventId, roomId).catch(() => ({ error: "Check your connection, then try again." }));
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  };

  return (
    <section aria-labelledby="door-link" className="mt-8 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-6">
      <h2 id="door-link" className="text-lg font-semibold">
        Door link for {roomName}
      </h2>
      <p className="mt-1 text-sm leading-6">
        For whoever is at this room&apos;s door, with no sign-in. Anyone with the link can mark groups in {roomName} only, until it&apos;s
        turned off. It shows this room&apos;s list and nobody&apos;s contact details.
      </p>
      <p className="mt-2 text-sm leading-6">
        {expired ? `Door links stopped working at the end of ${until}.` : `Works until the end of ${until}.`}
      </p>
      {!posted && <p className="mt-2 text-sm leading-6">The link works once the festival is published and the schedule is posted.</p>}
      {live && door ? (
        <>
          <p className="mt-3 break-all rounded-md bg-background px-3 py-2 font-mono text-sm ring-1 ring-border">{door.url.replace(/^https?:\/\//, "")}</p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {door.qr && (
              <span
                role="img"
                aria-label={`QR code for ${roomName}'s door link`}
                className="block size-40 shrink-0 rounded-md bg-white p-1 ring-1 ring-border [&_svg]:size-full"
                dangerouslySetInnerHTML={{ __html: door.qr }}
              />
            )}
            <div className="flex flex-col gap-2">
              <CopyLink url={door.url} className={OUT} ariaLabel={`Copy ${roomName}'s door link`} />
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void make()}>
                {busy === "new" ? "Making…" : "Make a new link"}
              </Button>
              <Button type="button" variant="danger" disabled={busy !== null} onClick={() => void off()}>
                {busy === "off" ? "Turning off…" : "Turn off this link"}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <>
          {door && !door.on && !expired && <p className="mt-3 text-sm font-semibold">This room&apos;s door link is turned off.</p>}
          {!expired && (
          <div className="mt-3">
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void make()}>
              {busy === "new" ? "Making…" : door ? "Make a new link" : "Make a door link"}
            </Button>
          </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          <span aria-hidden>▲ </span>
          {error}
        </p>
      )}
    </section>
  );
}
