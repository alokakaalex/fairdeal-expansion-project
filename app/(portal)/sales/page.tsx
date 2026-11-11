import type { Metadata } from "next";
import TeamHome from "@/components/portal/TeamHome";
import { requireRole } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sales review" };

export default async function Page() {
  const user = await requireRole("sales");
  return <TeamHome user={user} title="Sales review" waitingLabel="Awaiting your decision" />;
}
