import { NextRequest, NextResponse } from "next/server";
import { ROLE_INFO } from "@/lib/expansion/roles";
import { config } from "@/lib/server/config";
import { endSession, sessionUserAnyStatus } from "@/lib/server/session";
import { exchangeCode } from "@/lib/server/supabaseAuth";

// Google sends people back here (via Supabase) with a one-time code. Signing
// in with Google only works for emails an access manager has already added.
export async function GET(request: NextRequest) {
  const back = (path: string) => NextResponse.redirect(new URL(path, config.appUrl));
  const code = request.nextUrl.searchParams.get("code");
  if (config.authProvider !== "supabase" || !code) return back("/login");
  if (!(await exchangeCode(code))) return back("/login?error=link");

  const user = await sessionUserAnyStatus();
  if (!user) {
    await endSession();
    return back("/login?error=no-access");
  }
  return back(user.status === "active" ? ROLE_INFO[user.role].portal : "/auth/set-password");
}
