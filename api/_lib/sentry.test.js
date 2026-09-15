import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { initMock, captureExceptionMock } = vi.hoisted(() => ({
  initMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  init: initMock,
  captureException: captureExceptionMock,
}));

describe("sentry scaffolding", () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    // Each test needs its own fresh module instance so the "initialized" memo (private
    // module state in sentry.js, same lazy/memoized pattern as getSupabaseAdminClient())
    // doesn't leak init() calls between the no-DSN and with-DSN tests below.
    vi.resetModules();
    initMock.mockReset();
    captureExceptionMock.mockReset();
  });

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it("isSentryConfigured is false and captureError is a silent no-op when SENTRY_DSN is unset", async () => {
    delete process.env.SENTRY_DSN;
    const { isSentryConfigured, captureError } = await import("./sentry.js");

    expect(isSentryConfigured()).toBe(false);

    expect(() => captureError(new Error("boom"), { code: "TEST" })).not.toThrow();
    expect(initMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("initializes once and reports with the given tags when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://example.ingest.sentry.io/1";
    const { isSentryConfigured, captureError } = await import("./sentry.js");

    expect(isSentryConfigured()).toBe(true);

    const err = new Error("boom");
    captureError(err, { code: "TEST_CODE" });
    captureError(err, { code: "TEST_CODE" });

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith(expect.objectContaining({ dsn: process.env.SENTRY_DSN }));
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { tags: { code: "TEST_CODE" } });
  });
});
