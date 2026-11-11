import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Keeps Supabase sign-in sessions fresh: when the short-lived access token
// has expired, this swaps it for a new one before the page renders and
// writes the new cookies. A no-op unless Supabase sign-in is configured.
// (Next.js 16 calls this file proxy.ts; it used to be middleware.ts.)

export async function proxy(request: NextRequest) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || process.env.DEMO_MODE === "true") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Verifies the token and refreshes it if needed (the page still checks who is signed in).
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Pages and file downloads only. Not static assets, health checks or the
  // backup job — and never uploads: with a proxy, Next.js buffers request
  // bodies (10 MB by default), which would cut large upload chunks short.
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|api/health|api/cron|api/uploads).*)"],
};
