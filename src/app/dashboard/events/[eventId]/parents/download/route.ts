import { type NextRequest } from "next/server";
import { csvFileName, CSV_TYPE, toCsv, type CsvValue } from "@/lib/csv";
import { createClient } from "@/lib/supabase/server";
import {
  checkInReport,
  checkInSummary,
  classListCsvRows,
  recordDownload,
  reportCsvRows,
  visitorList,
  visitorListCsvRows,
  type ListKind,
} from "@/lib/visitor-lists";

// Parent Registration's downloads, built here from Host/Co-host-only database
// functions and noted in the event's download log:
//   ?list=visitor  the visitor list for the school's visitor system (one row per adult per child)
//   ?list=class    the class list (one row per child)
//   ?list=report   the visitor check-in report
const KINDS: Record<string, { kind: ListKind; name: string }> = {
  visitor: { kind: "visitor_list", name: "visitor list" },
  class: { kind: "class_list", name: "class list" },
  report: { kind: "report_download", name: "visitor check-in report" },
};

export async function GET(request: NextRequest, ctx: RouteContext<"/dashboard/events/[eventId]/parents/download">) {
  const { eventId } = await ctx.params;
  const which = KINDS[request.nextUrl.searchParams.get("list") ?? ""];
  if (!which || !/^[0-9a-f-]{36}$/i.test(eventId)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("name, timezone").eq("id", eventId).maybeSingle();
  if (!event) return new Response("Not found", { status: 404 });

  let rows: CsvValue[][];
  try {
    if (which.kind === "visitor_list") rows = visitorListCsvRows(await visitorList(supabase, eventId));
    else if (which.kind === "class_list") rows = await classListCsvRows(supabase, eventId, event.timezone);
    else {
      const [report, summary] = await Promise.all([checkInReport(supabase, eventId), checkInSummary(supabase, eventId)]);
      rows = reportCsvRows(report, summary, event.timezone);
    }
    await recordDownload(supabase, eventId, which.kind, rows.length - 1);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new Response("Only the event's Hosts and Co-hosts can download this.", { status: 403 });
    console.error(`Parent download (${which.kind}) failed`, e);
    return new Response("Something went wrong. Please try again.", { status: 500 });
  }

  const fileName = csvFileName(`${event.name} ${which.name}`, which.name);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": CSV_TYPE,
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
