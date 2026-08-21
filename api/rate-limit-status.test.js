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
  RATE_LIMIT_MAX: 5,
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
    expect(res.body).toEqual({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled: true });
  });

  it("still queries the real rate limit when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalled();
    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: true });
  });

  it("still queries the real rate limit when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const res = createMockRes();

    await handler(req(), res);

    expect(createRatelimitMock).toHaveBeenCalled();
    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: true });
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

    expect(res.body).toEqual({ limit: 5, remaining: 3, reset: 1234567890, instagramEnabled: false });
  });

  it("reports instagramEnabled: false even in the dev-bypass response", async () => {
    process.env.NODE_ENV = "development";
    process.env.INSTAGRAM_ENABLED = "false";
    const res = createMockRes();

    await handler(req(), res);

    expect(res.body).toEqual({ limit: null, remaining: null, reset: null, unlimited: true, instagramEnabled: false });
  });
});
