import { z } from "zod";

// Registering a group for a festival (board 16): the short form. Only what the organizer asks for (Registration
// step: ask_chaperones, ask_buses, ask_availability); classification only when the festival has classifications.
// The database checks the rest (bands_validate: a festival classification, a festival day, the group limit).

export type FestivalAsks = {
  classifications: string[];
  ask_chaperones: boolean;
  ask_buses: boolean;
  ask_availability: boolean;
  chaperone_limit: number;
  starts_on: string;
  ends_on: string;
};

const count = (label: string, max: number) =>
  z.coerce.number({ message: `${label}: enter a number` }).int(`${label}: whole numbers only`).min(0, `${label} can't be negative`).max(max, `${label} looks too high`);
const clock = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\d{2}:\d{2}$/.test(v), "Pick a time from the list")
  .transform((v) => v || null);

/** The festival form's answers as bands columns, or the first problem in words. */
export function parseFestival(formData: FormData, ev: FestivalAsks, email: string) {
  const get = (k: string) => String(formData.get(k) ?? "");
  const schema = z.object({
    bandName: z.string().trim().min(2, "Group name: fill this in").max(150),
    schoolName: z.string().trim().min(2, "School: fill this in").max(150),
    classification: ev.classifications.length
      ? z.string().refine((v) => ev.classifications.includes(v), "Classification: pick one of the festival's")
      : z.string().transform(() => null),
    studentCount: count("Performers", 1000).min(1, "Performers: enter how many"),
    chaperoneCount: ev.ask_chaperones ? count("Chaperones", ev.chaperone_limit) : z.any().transform(() => null),
    busCount: ev.ask_buses ? count("Buses", 50) : z.any().transform(() => 0),
    availableDay: z
      .string()
      .transform((v) => (ev.ask_availability && ev.starts_on !== ev.ends_on && v && v >= ev.starts_on && v <= ev.ends_on ? v : null)),
    earliest: ev.ask_availability ? clock : z.any().transform(() => null),
    latest: ev.ask_availability ? clock : z.any().transform(() => null),
    notes: z.string().trim().max(2000, "Keep the note under 2,000 characters").transform((v) => v || null),
  });
  const parsed = schema.safeParse({
    bandName: get("bandName"),
    schoolName: get("schoolName"),
    classification: get("classification"),
    studentCount: get("studentCount"),
    chaperoneCount: get("chaperoneCount") || (ev.ask_chaperones ? "" : null),
    busCount: get("busCount") || 0,
    availableDay: get("availableDay"),
    earliest: get("earliestStart"),
    latest: get("latestFinish"),
    notes: get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message } as const;
  const v = parsed.data;
  if (ev.ask_chaperones && get("chaperoneCount") === "") return { error: "Chaperones: enter how many (0 is fine)" } as const;
  if (v.earliest && v.latest && v.earliest >= v.latest) return { error: "The latest your group can finish has to be after the earliest it can start." } as const;
  return {
    columns: {
      band_name: v.bandName,
      school_name: v.schoolName,
      classification: v.classification as string | null,
      student_count: v.studentCount,
      chaperone_count: v.chaperoneCount as number | null,
      bus_count: v.busCount as number,
      contact_email: email,
      head_director_email: email,
      contest_day_conflicts: v.notes,
      available_day: v.availableDay,
      earliest_start: v.earliest as string | null,
      latest_finish: v.latest as string | null,
    },
  } as const;
}

export type FestivalColumns = NonNullable<ReturnType<typeof parseFestival>["columns"]>;
