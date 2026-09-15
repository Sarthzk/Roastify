import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The anon key is safe to ship to the browser by design (RLS is what actually protects
// data — see supabase/migrations/) — it's SUPABASE_SERVICE_ROLE_KEY, never used here,
// that must stay server-only.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Null when Supabase isn't configured (a fork, or local dev without a project) — every
// caller checks isSupabaseConfigured (or just handles a null supabase) rather than this
// module crashing the app on import; the app must work fully anonymous-only either way.
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
