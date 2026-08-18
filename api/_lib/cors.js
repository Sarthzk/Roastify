const ALLOWED_ORIGIN = "https://roastify-two.vercel.app";

export function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Applies CORS headers and, if this was a preflight OPTIONS request, ends the
// response. Returns true when the caller should stop (request fully handled).
export function handleCorsPreflight(req, res) {
  applyCors(res);
  if (req.method !== "OPTIONS") return false;
  res.status(204).end();
  return true;
}
