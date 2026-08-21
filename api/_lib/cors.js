const PRODUCTION_ORIGIN = "https://roastify-two.vercel.app";
// Vercel preview deployments for this project are named "roastify-two-<slug>.vercel.app".
const PREVIEW_ORIGIN_PATTERN = /^https:\/\/roastify-two-[a-z0-9-]+\.vercel\.app$/;
const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/;

function isAllowedOrigin(origin) {
  return origin === PRODUCTION_ORIGIN || PREVIEW_ORIGIN_PATTERN.test(origin) || LOCALHOST_ORIGIN_PATTERN.test(origin);
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Applies CORS headers and, if this was a preflight OPTIONS request, ends the
// response. Returns true when the caller should stop (request fully handled).
export function handleCorsPreflight(req, res) {
  applyCors(req, res);
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}
