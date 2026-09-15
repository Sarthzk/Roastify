import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { getAuthenticatedUserMock, deleteUserMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
  deleteUserMock: vi.fn(async () => ({ error: null })),
}));

vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
}));

// A minimal fake of the real admin client — just the one method this handler touches. No
// live Supabase calls, matching the repo's testing norms (see history.test.js).
vi.mock("./_lib/supabaseAdmin.js", () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: deleteUserMock } } }),
}));

const { default: handler } = await import("./account.js");

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

function req({ authorization, method = "DELETE" } = {}) {
  return { method, url: "/api/account", headers: authorization ? { authorization } : {} };
}

describe("DELETE /api/account", () => {
  afterEach(() => {
    getAuthenticatedUserMock.mockReset();
    getAuthenticatedUserMock.mockResolvedValue(null);
    deleteUserMock.mockReset();
    deleteUserMock.mockResolvedValue({ error: null });
  });

  it("rejects a non-DELETE method", async () => {
    const res = createMockRes();

    await handler(req({ method: "GET" }), res);

    expect(res.statusCode).toBe(405);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no Authorization header with SIGN_IN_REQUIRED (401)", async () => {
    const res = createMockRes();

    await handler(req(), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("deletes the account belonging to the verified JWT, never a client-sent id", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token" }), res);

    expect(deleteUserMock).toHaveBeenCalledWith("user-1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns a real 500 envelope (not a crash) when the admin delete itself errors", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    deleteUserMock.mockResolvedValue({ error: new Error("admin api unreachable") });
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
