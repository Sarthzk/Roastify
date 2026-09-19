import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { getAuthenticatedUserMock, getSupabaseClientForUserMock, queryMock, ltMock, eqMock, ilikeMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
  getSupabaseClientForUserMock: vi.fn(),
  queryMock: vi.fn(),
  ltMock: vi.fn(),
  eqMock: vi.fn(),
  ilikeMock: vi.fn(),
}));

vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  extractBearerToken: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  },
}));

// A minimal chainable fake of the real Supabase query builder — .from().select()
// .order().limit()/.delete().eq() all return `this`, and the chain itself is awaitable
// via `.then`, same as the real client. queryMock records the final resolved
// { data, error } (or { error, count } for a delete) per test and
// getSupabaseClientForUserMock records which token built the client, so tests can assert
// the endpoint queries *as the caller* (RLS-backed) rather than via any admin/service-role
// client. No live Supabase calls — matches the repo's testing norms.
function makeFakeClient() {
  const builder = {
    from: () => builder,
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    lt: (...args) => {
      ltMock(...args);
      return builder;
    },
    delete: () => builder,
    eq: (...args) => {
      eqMock(...args);
      return builder;
    },
    ilike: (...args) => {
      ilikeMock(...args);
      return builder;
    },
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

function req({ authorization, url = "/api/history", method = "GET" } = {}) {
  return { method, url, headers: authorization ? { authorization } : {} };
}

describe("GET /api/history", () => {
  afterEach(() => {
    getAuthenticatedUserMock.mockReset();
    getAuthenticatedUserMock.mockResolvedValue(null);
    getSupabaseClientForUserMock.mockReset();
    queryMock.mockReset();
    ltMock.mockReset();
    eqMock.mockReset();
    ilikeMock.mockReset();
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

  it("applies persona and type filters as exact-match queries", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [], error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer t", url: "/api/history?persona=recruiter&type=github" }), res);

    expect(eqMock).toHaveBeenCalledWith("persona", "recruiter");
    expect(eqMock).toHaveBeenCalledWith("type", "github");
    expect(ilikeMock).not.toHaveBeenCalled();
  });

  it("searches identifier case-insensitively as a substring, escaping LIKE wildcards", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [], error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer t", url: `/api/history?q=${encodeURIComponent("50%_a\\b")}` }), res);

    expect(ilikeMock).toHaveBeenCalledWith("identifier", "%50\\%\\_a\\\\b%");
  });

  it("returns nextCursor null when fewer than a full page comes back", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [{ id: "r1", created_at: "2026-09-12T00:00:00Z" }], error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(res.body.nextCursor).toBeNull();
  });

  it("returns a real nextCursor (the last row's created_at) when a full page comes back", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    // PAGE_SIZE is 25 — a full page must actually be full for nextCursor to be non-null.
    const fullPage = Array.from({ length: 25 }, (_, i) => ({
      id: `r${i}`,
      created_at: `2026-09-${String(25 - i).padStart(2, "0")}T00:00:00Z`,
    }));
    queryMock.mockReturnValue({ data: fullPage, error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(res.body.roasts).toHaveLength(25);
    expect(res.body.nextCursor).toBe(fullPage[24].created_at);
  });

  it("passes no cursor filter on the first page (no ?cursor= given)", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [], error: null });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(200);
    expect(ltMock).not.toHaveBeenCalled();
  });

  it("filters strictly older than the given ?cursor= for the next page", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ data: [], error: null });
    const res = createMockRes();
    const cursor = "2026-09-12T00:00:00Z";

    await handler(req({ authorization: "Bearer real-user-token", url: `/api/history?cursor=${encodeURIComponent(cursor)}` }), res);

    expect(ltMock).toHaveBeenCalledWith("created_at", cursor);
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

describe("DELETE /api/history", () => {
  afterEach(() => {
    getAuthenticatedUserMock.mockReset();
    getAuthenticatedUserMock.mockResolvedValue(null);
    getSupabaseClientForUserMock.mockReset();
    queryMock.mockReset();
  });

  it("rejects a request with no Authorization header with SIGN_IN_REQUIRED (401)", async () => {
    const res = createMockRes();

    await handler(req({ method: "DELETE", url: "/api/history?id=r1" }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a missing id with MISSING_INPUT (400) without touching the client", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const res = createMockRes();

    await handler(req({ method: "DELETE", url: "/api/history", authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("MISSING_INPUT");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("deletes via a client scoped to the caller's own token, never a different one", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ error: null, count: 1 });
    const res = createMockRes();

    await handler(req({ method: "DELETE", url: "/api/history?id=r1", authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(200);
    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(res.body).toEqual({ ok: true });
  });

  it("returns ROAST_NOT_FOUND (404) when the id doesn't exist or isn't the caller's — same response either way", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ error: null, count: 0 });
    const res = createMockRes();

    await handler(req({ method: "DELETE", url: "/api/history?id=someone-elses-roast", authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("ROAST_NOT_FOUND");
  });

  it("returns a real 500 envelope (not a crash) when the delete itself errors", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockReturnValue({ error: new Error("db unreachable"), count: null });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = createMockRes();
      await handler(req({ method: "DELETE", url: "/api/history?id=r1", authorization: "Bearer real-user-token" }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
