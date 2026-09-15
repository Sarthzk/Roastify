import { describe, it, expect, vi, afterEach } from "vitest";

// vi.hoisted is required here (rather than a plain module-scope const) because vi.mock's
// factory is hoisted above regular imports/declarations.
const { insertMock, isSupabaseConfiguredMock } = vi.hoisted(() => ({
  insertMock: vi.fn(async () => ({ error: null })),
  isSupabaseConfiguredMock: vi.fn(() => true),
}));

vi.mock("./supabaseAdmin.js", () => ({
  isSupabaseConfigured: isSupabaseConfiguredMock,
  getSupabaseAdminClient: () => ({ from: () => ({ insert: insertMock }) }),
}));

const { persistRoast, PROFILE_DATA_RETENTION_DAYS } = await import("./persistRoast.js");

function baseArgs(overrides = {}) {
  return {
    userId: "user-1",
    type: "github",
    identifier: "octocat",
    persona: "cynic",
    severity: "medium",
    model: "GPT-OSS 120B",
    roast: "You are pathetic.",
    tips: ["Fix your bio."],
    ...overrides,
  };
}

describe("persistRoast — profile data storage (github/instagram only)", () => {
  afterEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
    isSupabaseConfiguredMock.mockReset();
    isSupabaseConfiguredMock.mockReturnValue(true);
  });

  it("stores profileData for a github roast, with a future expiry", async () => {
    await persistRoast(baseArgs({ type: "github", profileData: "GitHub Profile: octocat\nBio: probably a cat" }));

    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBe("GitHub Profile: octocat\nBio: probably a cat");
    expect(insertedRow.profile_data_expires_at).not.toBeNull();
    expect(new Date(insertedRow.profile_data_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("stores profileData for an instagram roast", async () => {
    await persistRoast(baseArgs({ type: "instagram", identifier: "octocat", profileData: "Username: octocat\nBio: meow" }));

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBe("Username: octocat\nBio: meow");
    expect(insertedRow.profile_data_expires_at).not.toBeNull();
  });

  it("the stored expiry is PROFILE_DATA_RETENTION_DAYS from now", async () => {
    const before = Date.now();
    await persistRoast(baseArgs({ type: "github", profileData: "profile text" }));
    const after = Date.now();

    const insertedRow = insertMock.mock.calls[0][0];
    const expiresAt = new Date(insertedRow.profile_data_expires_at).getTime();
    const expectedMs = PROFILE_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + expectedMs - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + expectedMs + 1000);
  });

  it("never stores profileData for a linkedin roast, even if the caller passes one", async () => {
    await persistRoast(
      baseArgs({ type: "linkedin", identifier: null, profileData: "should never be written: name, employer, phone" })
    );

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBeNull();
    expect(insertedRow.profile_data_expires_at).toBeNull();
  });

  it("never stores profileData for a resume roast, even if the caller passes one", async () => {
    await persistRoast(
      baseArgs({ type: "resume", identifier: null, profileData: "should never be written: full resume text" })
    );

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBeNull();
    expect(insertedRow.profile_data_expires_at).toBeNull();
  });

  it("stores null profile_data/expiry for github/instagram when no profileData is given", async () => {
    await persistRoast(baseArgs({ type: "github", profileData: undefined }));

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBeNull();
    expect(insertedRow.profile_data_expires_at).toBeNull();
  });

  it("treats an empty-string profileData as absent, not as a value to store", async () => {
    await persistRoast(baseArgs({ type: "github", profileData: "" }));

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow.profile_data).toBeNull();
    expect(insertedRow.profile_data_expires_at).toBeNull();
  });

  it("is a no-op when Supabase isn't configured, regardless of type", async () => {
    isSupabaseConfiguredMock.mockReturnValue(false);

    await persistRoast(baseArgs({ type: "github", profileData: "profile text" }));

    expect(insertMock).not.toHaveBeenCalled();
  });
});
