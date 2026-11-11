import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { config } from "./config";

// Supabase clients, server-side only. Browsers never talk to Supabase Auth
// directly and never see a key: sign-in, sign-out and links all go through
// server actions, and files move with short-lived signed URLs.

function settings() {
  if (!config.supabase) throw new Error("Supabase is not configured (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).");
  return config.supabase;
}

/**
 * Acts as the person making this request; their session lives in httpOnly
 * cookies that @supabase/ssr reads and refreshes. In server components
 * cookies are read-only, so a refreshed session is written by proxy.ts.
 */
export async function authClient(): Promise<SupabaseClient> {
  const s = settings();
  const store = await cookies();
  return createServerClient(s.url, s.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Rendering a server component: proxy.ts keeps the cookies fresh instead.
        }
      },
    },
  });
}

const globalForSupabase = globalThis as unknown as { __supabaseAdmin?: SupabaseClient };

/** Service-role client: creates invite links, bans users, signs storage URLs. Never leaves the server. */
export function adminClient(): SupabaseClient {
  const s = settings();
  globalForSupabase.__supabaseAdmin ??= createClient(s.url, s.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return globalForSupabase.__supabaseAdmin;
}

/** A throwaway client with no cookies, for checking a password without touching the current session. */
export function anonClient(): SupabaseClient {
  const s = settings();
  return createClient(s.url, s.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
