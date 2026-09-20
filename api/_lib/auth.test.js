import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations. isSupabaseConfigured defaults to
// true so most tests exercise real getAuthenticatedUser logic against a mocked jose
// verification — no live network calls, per "Mock Supabase — no live calls in tests."
const { jwtVerifyMock, isSupabaseConfiguredMock } = vi.hoisted(() => ({
  jwtVerifyMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(() => true),
}));
vi.mock("jose", () => ({
  jwtVerify: jwtVerifyMock,
  createRemoteJWKSet: vi.fn(() => "jwks-placeholder"),
}));
vi.mock("./supabaseAdmin.js", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  getSupabaseUrl: () => "https://project.supabase.co",
}));

const { getAuthenticatedUser } = await import("./auth.js");

function reqWithAuth(header) {
  return { headers: header === undefined ? {} : { authorization: header } };
}

describe("getAuthenticatedUser", () => {
  afterEach(() => {
    jwtVerifyMock.mockReset();
    isSupabaseConfiguredMock.mockReset();
    isSupabaseConfiguredMock.mockReturnValue(true);
  });

  it("returns the derived { id, email } for a valid token", async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "user-1", email: "a@b.com" } });

    const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));

    expect(user).toEqual({ id: "user-1", email: "a@b.com" });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "valid-token",
      "jwks-placeholder",
      expect.objectContaining({ audience: "authenticated" })
    );
  });

  it("returns null for an invalid/expired token, without throwing", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const user = await getAuthenticatedUser(reqWithAuth("Bearer garbage-token"));
      expect(user).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("returns null when the Authorization header is absent, without verifying", async () => {
    const user = await getAuthenticatedUser(reqWithAuth(undefined));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("returns null for a non-Bearer Authorization header", async () => {
    const user = await getAuthenticatedUser(reqWithAuth("Basic dXNlcjpwYXNz"));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("returns null for a Bearer header with no token", async () => {
    const user = await getAuthenticatedUser(reqWithAuth("Bearer "));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("treats the request as anonymous (returns null) when Supabase isn't configured, without verifying", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);

    const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));

    expect(user).toBeNull();
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it("returns null (rather than throwing) if the JWKS fetch/verification itself rejects", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("network error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const user = await getAuthenticatedUser(reqWithAuth("Bearer valid-token"));
      expect(user).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
