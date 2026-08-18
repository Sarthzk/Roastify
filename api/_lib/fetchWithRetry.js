const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// Retries transient network errors and 5xx/429 responses with exponential backoff.
// Non-retryable responses (4xx other than 429) are returned as-is on the first attempt
// so callers can keep their existing `if (!res.ok)` handling unchanged.
export async function fetchWithRetry(url, options = {}, { retries = 2, baseDelayMs = 500 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || attempt === retries || !RETRYABLE_STATUS.has(response.status)) {
        return response;
      }
      lastError = new Error(`Request to ${url} failed with status ${response.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
  }

  throw lastError;
}
