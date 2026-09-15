import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { getAuthenticatedUserMock, getSupabaseClientForUserMock, queryMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
  getSupabaseClientForUserMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  extractBearerToken: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  },
}));

// A minimal chainable fake of the real Supabase query builder — .from().select()
// .order().limit() all return `this`, and the chain itself is awaitable via `.then`,
// same as the real client. queryMock records the final resolved { data, error } per test
// and getSupabaseClientForUserMock records which token built the client, so tests can
// assert the endpoint queries *as the caller* (RLS-backed) rather than via any
// admin/service-role client. No live Supabase calls — matches the repo's testing norms.
function makeFakeClient() {
  const builder = {
    from: () => builder,
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    lt: () => builder,
    then: (resolve) => resolve(queryMock()),
  };
  return builder;
}
vi.mock("./_lib/supabaseUser.js", () => ({
  getSupabaseClientForUser: (token) => {
    getSupabaseClientForUserMock(token);
    return makeFakeClient();
  },
}));

const { default: handler } = await import("./history.js");

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

function req({ authorization, url = "/api/history" } = {}) {
  return { method: "GET", url, headers: authorization ? { authorization } : {} };
}

describe("GET /api/history", () => {
  afterEach(() => {
    getAuthenticatedUserMock.mockReset();
    getAuthenticatedUserMock.mockResolvedValue(null);
    getSupabaseClientForUserMock.mockReset();
    queryMock.mockReset();
  });

  it("rejects a request with no Authorization header with SIGN_IN_REQUIRED (401)", async () => {
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: { code: "SIGN_IN_REQUIRED", message: "Sign in to see your roast history.", retryable: false },
    });
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a request with an invalid/expired token with SIGN_IN_REQUIRED (401)", async () => {
    getAuthenticatedUserMock.mockResolvedValue(null);
    const res = createMockRes();

    await handler(req({ authorization: "Bearer garbage-token" }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("queries via a client scoped to the caller's own token, never a different one", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({
      data: [{ id: "r1", type: "github", identifier: "octocat", persona: "cynic", severity: "medium", created_at: "2026-09-12T00:00:00Z" }],
      error: null,
    });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(200);
    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(res.body.roasts).toHaveLength(1);
    expect(res.body.roasts[0]).toMatchObject({ type: "github", identifier: "octocat" });
  });

  it("returns nextCursor null when fewer than a full page comes back", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [{ id: "r1", created_at: "2026-09-12T00:00:00Z" }], error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(res.body.nextCursor).toBeNull();
  });

  it("returns a real 500 envelope (not a crash) when the query itself errors", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: null, error: new Error("db unreachable") });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = createMockRes();
      await handler(req({ authorization: "Bearer real-user-token" }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
