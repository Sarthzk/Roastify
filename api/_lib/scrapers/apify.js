import { fetchWithRetry } from "../fetchWithRetry.js";
import { ERROR_CODES, RoastError } from "../errors.js";
import { captureError } from "../sentry.js";

// Poll budget kept short so scraping leaves enough of the 60s function maxDuration (see
// vercel.json) for the LLM call that follows.
const APIFY_POLL_MAX_ATTEMPTS = 10;
const APIFY_POLL_INTERVAL_MS = 2000;

// Starts an Apify actor run — trying each candidate slug in sequence, since actor slugs
// get renamed/deprecated on Apify — then polls until the run reaches SUCCEEDED or
// FAILED, then fetches the resulting dataset items. Instagram is the only remaining
// caller (LinkedIn scraping was removed in favor of PDF upload — the Apify LinkedIn
// actor never worked against LinkedIn's unauthenticated-request blocking), but this
// stays its own module since it's a distinct concern (Apify's HTTP protocol) from
// Instagram's own field-extraction logic.
export async function runApifyScrape({
  actorCandidates,
  requestBody,
  apifyToken,
  startFailureMessage,
  datasetFetchFailureMessage,
}) {
  let runId = null;
  let defaultDatasetId = null;
  const startErrors = [];

  for (const actor of actorCandidates) {
    try {
      // Bounded to 1 retry — this POST starts a billed actor run, so we don't want to
      // pile on retries and risk starting the same run multiple times.
      const resp = await fetchWithRetry(
        `https://api.apify.com/v2/acts/${actor}/runs`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apifyToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
        { retries: 1 }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "(no body)");
        startErrors.push({ actor, status: resp.status, body: text });
        continue;
      }

      const startData = await resp.json();
      runId = startData?.data?.id || startData?.id;
      defaultDatasetId = startData?.data?.defaultDatasetId || startData?.defaultDatasetId;
      break;
    } catch (err) {
      startErrors.push({ actor, error: err.message });
    }
  }

  if (!runId || !defaultDatasetId) {
    console.error("All actor attempts failed:", JSON.stringify(startErrors));
    // Tags stay minimal (code + how many actor slugs were tried) rather than forwarding
    // startErrors wholesale — those are Apify's own start-request responses, not scraped
    // profile content, but there's no reason to widen what Sentry sees beyond what's
    // actually useful for noticing the actor slug list needs updating.
    captureError(new Error(startFailureMessage), {
      code: ERROR_CODES.SCRAPE_UPSTREAM_FAILURE,
      actorCandidateCount: actorCandidates.length,
    });
    throw new RoastError(ERROR_CODES.SCRAPE_UPSTREAM_FAILURE, startFailureMessage, { status: 502, retryable: true });
  }

  let runStatus = "RUNNING";
  for (let attempt = 0; attempt < APIFY_POLL_MAX_ATTEMPTS; attempt += 1) {
    const statusResponse = await fetchWithRetry(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { Authorization: `Bearer ${apifyToken}` } },
      { retries: 1, baseDelayMs: 300 }
    );

    if (statusResponse.ok) {
      const statusData = await statusResponse.json();
      runStatus = statusData?.data?.status || statusData?.status;
      if (runStatus === "SUCCEEDED" || runStatus === "FAILED") break;
    }
    // A failed status check itself (as opposed to the actor reporting FAILED) is
    // treated the same as "still running" and silently retried until the poll budget
    // runs out, rather than failing the whole scrape on one flaky check.

    if (attempt < APIFY_POLL_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, APIFY_POLL_INTERVAL_MS));
    }
  }

  if (runStatus !== "SUCCEEDED") {
    return { succeeded: false, firstItem: null };
  }

  const datasetResponse = await fetchWithRetry(`https://api.apify.com/v2/datasets/${defaultDatasetId}/items`, {
    headers: { Authorization: `Bearer ${apifyToken}` },
  });

  if (!datasetResponse.ok) {
    throw new RoastError(ERROR_CODES.SCRAPE_UPSTREAM_FAILURE, datasetFetchFailureMessage, {
      status: 502,
      retryable: true,
    });
  }

  const items = await datasetResponse.json();
  return { succeeded: true, firstItem: Array.isArray(items) ? items[0] : null };
}
