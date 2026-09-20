import { jwtVerify, createRemoteJWKSet } from "jose";
import { isSupabaseConfigured, getSupabaseUrl } from "./supabaseAdmin.js";
import { reportError } from "./sentry.js";

// Pulls the raw JWT out of `Authorization: Bearer <jwt>`, or null for a missing/
// malformed header or an empty token. Shared by getAuthenticatedUser() below and by
// api/history.js, which needs the raw token itself (not just the verified user) to build
// a per-request client that queries as the caller — see api/_lib/supabaseUser.js.
export function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

// createRemoteJWKSet caches the fetched public keys internally and only re-fetches on a
// cache miss (e.g. an unrecognized `kid` after key rotation) — module-scope so a warm
// serverless invocation reuses it instead of re-fetching every request. Rebuilt only if
// the configured URL actually changes (never happens in production; guards test/dev
// env-var swaps), same lazy-build-once pattern getSupabaseAdminClient() uses.
let cachedJWKS = null;
let cachedJWKSUrl = null;
function getJWKS() {
  const url = `${getSupabaseUrl()}/auth/v1/.well-known/jwks.json`;
  if (url !== cachedJWKSUrl) {
    cachedJWKS = createRemoteJWKSet(new URL(url));
    cachedJWKSUrl = url;
  }
  return cachedJWKS;
}

// Verifies the `Authorization: Bearer <jwt>` header's signature locally against Supabase's
// published public keys (JWKS) and returns the user it actually belongs to — { id, email },
// read straight off the token's own claims, never a client-sent id. This used to call
// supabase.auth.getUser(token), a real network round trip to Supabase Auth on every single
// protected request — measured in production at 700ms-2s per call (see WORK_LOG.md), on
// top of the request's own DB query. Verifying the signature locally (this project's tokens
// are ES256, signed with Supabase's asymmetric keys — not the legacy shared secret) removes
// that round trip entirely for a warm invocation, since the JWKS above is cached.
// Deliberate trade-off: a token revoked server-side (sign-out-everywhere, account ban)
// keeps verifying successfully here until its own short expiry, rather than failing
// instantly — accepted because Supabase access tokens are short-lived, and every
// RLS-protected read/write this user id is then used for still goes through Supabase's own
// PostgREST gateway, which validates the same JWT again server-side. Returns null (treat
// the request as anonymous) for a missing/malformed header, an invalid/expired/wrong-
// audience token, an unreachable JWKS endpoint, or when Supabase isn't configured at all (a
// fork, or local dev without a project — see CLAUDE.md's "the app must work fully when
// Supabase env vars are absent" requirement).
export async function getAuthenticatedUser(req) {
  if (!isSupabaseConfigured()) return null;

  const token = extractBearerToken(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: `${getSupabaseUrl()}/auth/v1`,
      audience: "authenticated",
    });
    return { id: payload.sub, email: payload.email };
  } catch (err) {
    // A token was actually sent and failed verification (expired, malformed, wrong
    // project, JWKS unreachable) — distinct from the no-token-at-all case above, which is
    // just an anonymous request and never reaches here. Worth a Sentry issue: at volume
    // this is the signal for a real problem (key rotation, clock skew, an outage) rather
    // than any single caller's stale session.
    console.error("JWT verification failed:", err.message);
    reportError(err, { code: "JWT_VERIFICATION_FAILURE" });
    return null;
  }
}
