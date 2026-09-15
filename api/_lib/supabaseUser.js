import { createClient } from "@supabase/supabase-js";

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function getAnonKey() {
  return process.env.VITE_SUPABASE_ANON_KEY;
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getAnonKey());
}

// A per-request client authenticated as the caller (anon key + their own JWT as the
// Authorization header), so a query made with it runs under Postgres RLS as that user —
// `auth.uid()` resolves to their id, and the "read own roasts" policy in
// supabase/migrations/ is what actually restricts the result, not application code. Used
// for api/history.js instead of the service-role admin client (api/_lib/supabaseAdmin.js),
// which would bypass RLS entirely and make an app-level filtering bug a real data leak.
export function getSupabaseClientForUser(accessToken) {
  if (!isSupabaseConfigured()) return null;
  return createClient(getSupabaseUrl(), getAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
