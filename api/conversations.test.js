import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const {
  getAuthenticatedUserMock,
  getSupabaseClientForUserMock,
  roastSelectMock,
  conversationSelectMock,
  conversationDeleteMock,
  messagesSelectMock,
  insertPayloadMock,
  conversationInsertMock,
} = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
  getSupabaseClientForUserMock: vi.fn(),
  roastSelectMock: vi.fn(),
  conversationSelectMock: vi.fn(),
  conversationDeleteMock: vi.fn(),
  messagesSelectMock: vi.fn(),
  insertPayloadMock: vi.fn(),
  conversationInsertMock: vi.fn(),
}));

vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  extractBearerToken: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  },
}));

// A minimal chainable fake of the real Supabase query builder scoped to the caller's own
// JWT — same shape/philosophy as history.test.js's makeFakeClient: `.maybeSingle()` short-
// circuits with a per-table mock result (roasts vs. conversations), while a chain with no
// terminal call (the messages list, the conversation delete) resolves via `.then`,
// dispatched by which table `.from()` was last called with. Records which token built the
// client so tests can assert every query runs as the caller (RLS-backed), never via any
// admin/service-role client.
function makeUserClient() {
  const builder = {
    _table: null,
    from(table) {
      builder._table = table;
      return builder;
    },
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    delete: () => builder,
    maybeSingle: () => {
      if (builder._table === "roasts") return roastSelectMock();
      if (builder._table === "conversations") return conversationSelectMock();
      throw new Error(`unexpected maybeSingle() on table "${builder._table}"`);
    },
    then: (resolve) => {
      if (builder._table === "conversations") return resolve(conversationDeleteMock());
      if (builder._table === "messages") return resolve(messagesSelectMock());
      throw new Error(`unexpected await on table "${builder._table}"`);
    },
  };
  return builder;
}
vi.mock("./_lib/supabaseUser.js", () => ({
  getSupabaseClientForUser: (token) => {
    getSupabaseClientForUserMock(token);
    return makeUserClient();
  },
}));

// The service-role admin client — only ever touched for the conversation INSERT (there is
// no INSERT policy for the anon key; see the migration). insertPayloadMock records exactly
// what was written, so tests can assert the persona came from the roast row, never from
// the request body.
vi.mock("./_lib/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: () => ({
    from: () => ({
      insert: (payload) => {
        insertPayloadMock(payload);
        return { select: () => ({ single: () => conversationInsertMock() }) };
      },
    }),
  }),
}));

const { default: handler } = await import("./conversations.js");

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

function req({ authorization, method = "GET", url = "/api/conversations", body } = {}) {
  return { method, url, headers: authorization ? { authorization } : {}, body };
}

function resetAllMocks() {
  getAuthenticatedUserMock.mockReset();
  getAuthenticatedUserMock.mockResolvedValue(null);
  getSupabaseClientForUserMock.mockReset();
  roastSelectMock.mockReset();
  conversationSelectMock.mockReset();
  conversationDeleteMock.mockReset();
  messagesSelectMock.mockReset();
  insertPayloadMock.mockReset();
  conversationInsertMock.mockReset();
}

describe("POST /api/conversations (start)", () => {
  afterEach(resetAllMocks);

  it("rejects an anonymous request with SIGN_IN_REQUIRED (401), never touching the client", async () => {
    const res = createMockRes();

    await handler(req({ method: "POST", body: { roastId: "roast-1" } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("rejects a missing roastId with MISSING_INPUT (400) without querying", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const res = createMockRes();

    await handler(req({ method: "POST", authorization: "Bearer real-user-token", body: {} }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("MISSING_INPUT");
    expect(roastSelectMock).not.toHaveBeenCalled();
  });

  it("looks up the roast via a client scoped to the caller's own token", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    roastSelectMock.mockReturnValue({ data: { id: "roast-1", persona: "cynic" }, error: null });
    conversationInsertMock.mockReturnValue({
      data: { id: "conv-1", roast_id: "roast-1", persona: "cynic", created_at: "2026-09-16T00:00:00Z" },
      error: null,
    });
    const res = createMockRes();

    await handler(req({ method: "POST", authorization: "Bearer real-user-token", body: { roastId: "roast-1" } }), res);

    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(res.statusCode).toBe(201);
  });

  it("rejects a roast id that doesn't exist or isn't the caller's with ROAST_NOT_FOUND (404) — same response either way", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    roastSelectMock.mockReturnValue({ data: null, error: null });
    const res = createMockRes();

    await handler(
      req({ method: "POST", authorization: "Bearer real-user-token", body: { roastId: "someone-elses-roast" } }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("ROAST_NOT_FOUND");
    expect(insertPayloadMock).not.toHaveBeenCalled();
  });

  it("locks the conversation's persona to the roast's own persona — never a client-supplied one", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    roastSelectMock.mockReturnValue({ data: { id: "roast-1", persona: "recruiter" }, error: null });
    conversationInsertMock.mockReturnValue({
      data: { id: "conv-1", roast_id: "roast-1", persona: "recruiter", created_at: "2026-09-16T00:00:00Z" },
      error: null,
    });
    const res = createMockRes();

    // A client-supplied persona in the body — must be ignored entirely.
    await handler(
      req({
        method: "POST",
        authorization: "Bearer real-user-token",
        body: { roastId: "roast-1", persona: "desi-uncle" },
      }),
      res
    );

    expect(insertPayloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", roast_id: "roast-1", persona: "recruiter" })
    );
    expect(res.body.persona).toBe("recruiter");
  });

  it("returns a real 500 envelope (not a crash) when the insert itself errors", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    roastSelectMock.mockReturnValue({ data: { id: "roast-1", persona: "cynic" }, error: null });
    conversationInsertMock.mockReturnValue({ data: null, error: new Error("db unreachable") });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = createMockRes();
      await handler(req({ method: "POST", authorization: "Bearer real-user-token", body: { roastId: "roast-1" } }), res);
      expect(res.statusCode).toBe(500);
      expect(res.body.error.code).toBe("INTERNAL_ERROR");
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("GET /api/conversations (fetch with messages)", () => {
  afterEach(resetAllMocks);

  it("rejects an anonymous request with SIGN_IN_REQUIRED (401)", async () => {
    const res = createMockRes();

    await handler(req({ method: "GET", url: "/api/conversations?id=conv-1" }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
  });

  it("rejects a missing id with MISSING_INPUT (400)", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const res = createMockRes();

    await handler(req({ method: "GET", url: "/api/conversations", authorization: "Bearer real-user-token" }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("MISSING_INPUT");
  });

  it("returns CONVERSATION_NOT_FOUND (404) for an id that doesn't exist or isn't the caller's", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationSelectMock.mockReturnValue({ data: null, error: null });
    const res = createMockRes();

    await handler(
      req({ method: "GET", url: "/api/conversations?id=someone-elses", authorization: "Bearer real-user-token" }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("CONVERSATION_NOT_FOUND");
  });

  it("returns the conversation and its messages, oldest first, queried via the caller's own scoped client", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationSelectMock.mockReturnValue({
      data: { id: "conv-1", roast_id: "roast-1", persona: "cynic", created_at: "2026-09-16T00:00:00Z" },
      error: null,
    });
    messagesSelectMock.mockReturnValue({
      data: [
        { id: "m1", role: "user", content: "hi", created_at: "2026-09-16T00:00:01Z" },
        { id: "m2", role: "assistant", content: "hello", created_at: "2026-09-16T00:00:02Z" },
      ],
      error: null,
    });
    const res = createMockRes();

    await handler(
      req({ method: "GET", url: "/api/conversations?id=conv-1", authorization: "Bearer real-user-token" }),
      res
    );

    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe("conv-1");
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[0]).toMatchObject({ role: "user", content: "hi" });
  });
});

describe("DELETE /api/conversations", () => {
  afterEach(resetAllMocks);

  it("rejects an anonymous request with SIGN_IN_REQUIRED (401)", async () => {
    const res = createMockRes();

    await handler(req({ method: "DELETE", url: "/api/conversations?id=conv-1" }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
  });

  it("deletes via a client scoped to the caller's own token", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationDeleteMock.mockReturnValue({ error: null, count: 1 });
    const res = createMockRes();

    await handler(
      req({ method: "DELETE", url: "/api/conversations?id=conv-1", authorization: "Bearer real-user-token" }),
      res
    );

    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns CONVERSATION_NOT_FOUND (404) for an id that doesn't exist or isn't the caller's", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationDeleteMock.mockReturnValue({ error: null, count: 0 });
    const res = createMockRes();

    await handler(
      req({ method: "DELETE", url: "/api/conversations?id=someone-elses", authorization: "Bearer real-user-token" }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("CONVERSATION_NOT_FOUND");
  });
});
