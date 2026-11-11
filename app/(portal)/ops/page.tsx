import type { Metadata } from "next";
import TeamHome from "@/components/portal/TeamHome";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Ops site visits" };

export default async function Page() {
  const user = await requireRole("ops");
  return <TeamHome user={user} title="Ops site visits" waitingLabel="Awaiting your visit and decision" />;
}
