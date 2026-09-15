import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations. isSupabaseConfigured defaults to
// true so most tests exercise real getAuthenticatedUser logic against a mocked Supabase
// Auth client — no live calls, per "Mock Supabase — no live calls in tests."
const { getUserMock, isSupabaseConfiguredMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(() => true),
}));
vi.mock("./supabaseAdmin.js", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  getSupabaseAdminClient: () => ({ auth: { getUser: getUserMock } }),
}));

const { getAuthenticatedUser } = await import("./auth.js");

function reqWithAuth(header) {
  return { headers: header === undefined ? {} : { authorization: header } };
}

describe("getAuthenticatedUser", () => {
  afterEach(() => {
    getUserMock.mockReset();
    isSupabaseConfiguredMock.mockReset();
    isSupabaseConfiguredMock.mockReturnValue(true);
  });

  it("returns the derived { id, email } for a valid token", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.com" } }, error: null });

    const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));

    expect(user).toEqual({ id: "user-1", email: "a@b.com" });
    expect(getUserMock).toHaveBeenCalledWith("valid-token");
  });

  it("returns null for an invalid/expired token, without throwing", async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: new Error("invalid JWT") });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const user = await getAuthenticatedUser(reqWithAuth("Bearer garbage-token"));
      expect(user).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null when the Authorization header is absent, without calling Supabase", async () => {
    const user = await getAuthenticatedUser(reqWithAuth(undefined));

    expect(user).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns null for a non-Bearer Authorization header", async () => {
    const user = await getAuthenticatedUser(reqWithAuth("Basic dXNlcjpwYXNz"));

    expect(user).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns null for a Bearer header with no token", async () => {
    const user = await getAuthenticatedUser(reqWithAuth("Bearer "));

    expect(user).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("treats the request as anonymous (returns null) when Supabase isn't configured, without calling Supabase", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);

    const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));

    expect(user).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it("returns null (rather than throwing) if the Supabase Auth call itself rejects", async () => {
    getUserMock.mockRejectedValue(new Error("network error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));
      expect(user).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
