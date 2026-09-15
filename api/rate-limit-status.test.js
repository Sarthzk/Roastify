import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { createRatelimitMock } = vi.hoisted(() => ({
  createRatelimitMock: vi.fn(() => ({
    getRemaining: async () => ({ limit: 5, remaining: 3, reset: 1234567890 }),
  })),
}));
vi.mock("./_lib/rateLimit.js", () => ({
  getClientIP: () => "127.0.0.1",
  createRatelimit: createRatelimitMock,
  getRateLimitKey: (user, ip) => (user ? `user:${user.id}` : `ip:${ip}`),
  RATE_LIMIT_TIERS: { anonymous: { max: 3, window: "1 d" }, authenticated: { max: 15, window: "1 d" } },
}));

// Defaults to anonymous (null) — getAuthenticatedUser's own JWT-verification behavior is
// exercised directly in api/_lib/auth.test.js. Controllable per test (see the "signed-in
// tier" describe block below) so this file never needs real Supabase config, matching
// "Mock Supabase — no live calls in tests."
const { getAuthenticatedUserMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
}));
vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

const { default: handler } = await import("./rate-limit-status.js");

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
}

function req() {
  return { method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } };
}

describe("rate-limit-status handler — dev bypass", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    createRatelimitMock.mockClear();
  });

  it("returns an unlimited/bypassed marker without calling Upstash when NODE_ENV is development", async () => {
    process.env.NODE_ENV = "development";
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).not.toHaveBeenCalled();
    expect(res.body).toEqual({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled: true, signedIn: false, tier: "anonymous" });
  });

  it("still queries the real rate limit when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalled();
    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: true, signedIn: false, tier: "anonymous" });
  });

  it("still queries the real rate limit when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalled();
    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: true, signedIn: false, tier: "anonymous" });
  });
});

describe("rate-limit-status handler — Instagram kill switch", () => {
  const originalInstagramEnabled = process.env.INSTAGRAM_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalInstagramEnabled === undefined) delete process.env.INSTAGRAM_ENABLED;
    else process.env.INSTAGRAM_ENABLED = originalInstagramEnabled;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("reports instagramEnabled: false when INSTAGRAM_ENABLED=false, including in the Upstash success path", async () => {
    delete process.env.NODE_ENV;
    process.env.INSTAGRAM_ENABLED = "false";
    const res = createMockRes();

    await handler(req(), res);

    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: false, signedIn: false, tier: "anonymous" });
  });

  it("reports instagramEnabled: false even in the dev-bypass response", async () => {
    process.env.NODE_ENV = "development";
    process.env.INSTAGRAM_ENABLED = "false";
    const res = createMockRes();

    await handler(req(), res);

    expect(res.body).toEqual({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled: false, signedIn: false, tier: "anonymous" });
  });
});

describe("rate-limit-status handler — signed-in tier", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    getAuthenticatedUserMock.mockReset();
    getAuthenticatedUserMock.mockImplementation(async () => null);
    createRatelimitMock.mockClear();
  });

  it("queries the authenticated-tier bucket, keyed by user id, for a signed-in caller", async () => {
    delete process.env.NODE_ENV;
    getAuthenticatedUserMock.mockResolvedValueOnce({ id: "user-1", email: "a@b.com" });
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalledWith("authenticated");
    expect(res.body).toMatchObject({ signedIn: true, tier: "authenticated" });
  });

  it("reports signedIn: false and the anonymous tier for a request with no valid token", async () => {
    delete process.env.NODE_ENV;
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalledWith("anonymous");
    expect(res.body).toMatchObject({ signedIn: false, tier: "anonymous" });
  });
});
