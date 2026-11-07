import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getOrigin } from "@/lib/data";
import { loadMyTeam } from "./load";
import { MyTeamView } from "./view";

export const metadata: Metadata = { title: "My team" };

/** Everyone who helps run the account's events, in one place (docs/design-decisions/2026-11-10-my-team.md). */
export default async function MyTeamPage({ searchParams }: PageProps<"/dashboard/team">) {
  const user = await requireUser();
  const { account, became } = await searchParams;
  return (
    <MyTeamView team={await loadMyTeam(user.id, await getOrigin(), typeof account === "string" ? account : null)} becameHost={became === "host"} />
  );
}
