import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { updateMock, ltMock, isSupabaseConfiguredMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  ltMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(() => true),
}));

// A minimal chainable fake of the real Supabase query builder — .from().update().lt() is
// awaitable, resolving whatever updateMock() (configured per test) returns. No live
// Supabase calls, matching the repo's testing norms.
vi.mock("../_lib/supabaseAdmin.js", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  getSupabaseAdminClient: () => ({
    from: () => ({
      update: (payload) => ({
        lt: (...args) => {
          ltMock(payload, ...args);
          return updateMock();
        },
      }),
    }),
  }),
}));

const { default: handler } = await import("./purge-expired-profile-data.js");

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
  };
}

function req({ method = "GET", authorization } = {}) {
  return { method, headers: authorization ? { authorization } : {} };
}

function resetAllMocks() {
  updateMock.mockReset();
  updateMock.mockResolvedValue({ error: null, count: 0 });
  ltMock.mockReset();
  isSupabaseConfiguredMock.mockReset();
  isSupabaseConfiguredMock.mockReturnValue(true);
  delete process.env.CRON_SECRET;
}

describe("GET /api/cron/purge-expired-profile-data", () => {
  afterEach(resetAllMocks);

  it("rejects a non-GET method", async () => {
    const res = createMockRes();

    await handler(req({ method: "POST" }), res);

    expect(res.statusCode).toBe(405);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("purges rows past their expiry and reports how many", async () => {
    updateMock.mockResolvedValue({ error: null, count: 3 });
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ purged: 3 });
    expect(ltMock).toHaveBeenCalledWith(
      { profile_data: null, profile_data_expires_at: null },
      "profile_data_expires_at",
      expect.any(String)
    );
  });

  it("is a no-op when Supabase isn't configured", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.purged).toBe(0);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a real 500 (not a crash) when the update itself errors", async () => {
    updateMock.mockResolvedValue({ error: new Error("db unreachable"), count: null });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = createMockRes();
      await handler(req(), res);
      expect(res.statusCode).toBe(500);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("accepts any caller when CRON_SECRET is unset", async () => {
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(200);
  });

  it("rejects a caller without the correct CRON_SECRET when one is set", async () => {
    process.env.CRON_SECRET = "top-secret";
    const res = createMockRes();

    await handler(req({ authorization: "Bearer wrong-value" }), res);

    expect(res.statusCode).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header at all when CRON_SECRET is set", async () => {
    process.env.CRON_SECRET = "top-secret";
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(401);
  });

  it("accepts the exact bearer value matching CRON_SECRET — the shape Vercel's own Cron Jobs send", async () => {
    process.env.CRON_SECRET = "top-secret";
    const res = createMockRes();

    await handler(req({ authorization: "Bearer top-secret" }), res);

    expect(res.statusCode).toBe(200);
  });
});
