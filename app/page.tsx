import { redirect } from "next/navigation";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { currentUser } from "@/lib/server/session";

// Sends each person to the portal for their role.
export default async function Home() {
  const user = await currentUser();
  redirect(user ? ROLE_INFO[user.role].portal : "/login");
}
