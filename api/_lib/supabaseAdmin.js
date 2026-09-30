import { createClient } from "@supabase/supabase-js";

// The service role key is server-only and must never reach the client bundle — there is
// no VITE_ prefix on it, so Vite never inlines it into anything shipped to the browser
// (see CLAUDE.md's "Auth" section for how this is verified). The URL itself is the same
// value the client uses (VITE_SUPABASE_URL is not a secret), read here without the
// prefix requirement since this file only ever runs server-side.
// Exported so auth.js can build the JWKS URL for local JWT verification without a second
// copy of this env var fallback.
export function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

// True only when both the URL and the service role key are present. Callers must check
// this before touching the admin client — Supabase config is entirely optional (a fork,
// or local dev without a project) and the app must keep working, treating every request
// as anonymous, rather than crash on a missing env var.
export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Built lazily and memoized — same pattern as getClient() in api/roast.js, so a missing
// key doesn't crash the process at import time and this module stays importable by
// Vitest with no env vars set.
let cachedClient = null;
export function getSupabaseAdminClient() {
  if (!cachedClient) {
    cachedClient = createClient(getSupabaseUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}
