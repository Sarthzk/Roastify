import { describe, it, expect, vi, afterEach } from "vitest";
import { describeError, formatCountdown } from "./roasterErrors.js";

describe("formatCountdown", () => {
  it("formats whole minutes and seconds", () => {
    expect(formatCountdown(90_000)).toBe("1m 30s");
  });

  it("pads single-digit seconds", () => {
    expect(formatCountdown(65_000)).toBe("1m 05s");
  });

  it("clamps negative remaining time to 0s rather than going negative", () => {
    expect(formatCountdown(-5000)).toBe("0m 00s");
  });
});

describe("describeError", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps a RATE_LIMITED error to a detail line with a real countdown, from the error's own rateLimit snapshot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const err = Object.assign(new Error("Too many requests."), {
      code: "RATE_LIMITED",
      retryable: false,
      rateLimit: { reset: new Date("2026-01-01T00:01:30Z").getTime() },
    });

    const result = describeError(err, { type: "github" });

    expect(result).toEqual({
      code: "RATE_LIMITED",
      message: "Too many requests.",
      detail: "rate limit reached · resets in 1m 30s · err_rate_limited",
      retryable: false,
    });
  });

  it("names the checked source type for a SCRAPE_* error, never the raw submitted url/text", () => {
    const err = Object.assign(new Error("User not found."), {
      code: "SCRAPE_NOT_FOUND",
      retryable: false,
    });

    const result = describeError(err, { type: "instagram" });

    expect(result.detail).toBe("checked instagram · err_scrape_not_found");
    expect(result.detail).not.toContain("http");
  });

  it("falls back to a plain machine code for anything else", () => {
    const err = Object.assign(new Error("Something broke."), {
      code: "LLM_UPSTREAM_FAILURE",
      retryable: true,
    });

    const result = describeError(err, { type: "resume" });

    expect(result).toEqual({
      code: "LLM_UPSTREAM_FAILURE",
      message: "Something broke.",
      detail: "err_llm_upstream_failure",
      retryable: true,
    });
  });

  it("falls back to 'unknown' when the error has no code at all", () => {
    const err = new Error("Unexpected.");

    const result = describeError(err, { type: "github" });

    expect(result.code).toBeUndefined();
    expect(result.detail).toBe("err_unknown");
    expect(result.retryable).toBe(false);
  });
});
