import { describe, it, expect, vi, afterEach } from "vitest";

// The handler's rate-limit check fails open on any Upstash error (same reasoning as
// roast.test.js) — mocked to fail open instantly and deterministically instead of hitting
// a real (bogus) URL. vi.hoisted is required here because vi.mock's factory is hoisted
// above regular imports/declarations.
const { createRatelimitMock } = vi.hoisted(() => ({
  createRatelimitMock: vi.fn(() => ({
    limit: async () => {
      throw new Error("mock rate limiter: unreachable (tests always fail open)");
    },
  })),
}));
vi.mock("./_lib/rateLimit.js", () => ({
  getClientIP: () => "127.0.0.1",
  createRatelimit: createRatelimitMock,
  getRateLimitKey: (user, ip) => (user ? `user:${user.id}` : `ip:${ip}`),
  RATE_LIMIT_TIERS: { chat: { max: 60, window: "1 d" } },
}));

const { getAuthenticatedUserMock } = vi.hoisted(() => ({
  getAuthenticatedUserMock: vi.fn(async () => null),
}));
vi.mock("./_lib/auth.js", () => ({
  getAuthenticatedUser: getAuthenticatedUserMock,
  extractBearerToken: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  },
}));

const { getSupabaseClientForUserMock, conversationSelectMock, roastSelectMock, historySelectMock } = vi.hoisted(() => ({
  getSupabaseClientForUserMock: vi.fn(),
  conversationSelectMock: vi.fn(),
  roastSelectMock: vi.fn(),
  historySelectMock: vi.fn(),
}));

// A minimal chainable fake of the real Supabase query builder scoped to the caller's own
// JWT — `.maybeSingle()` short-circuits with a per-table result (conversations vs.
// roasts); the message-history query has no terminal call, so it resolves via `.then`
// instead (same dispatch-by-table-name approach as conversations.test.js).
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
    limit: () => builder,
    maybeSingle: () => {
      if (builder._table === "conversations") return conversationSelectMock();
      if (builder._table === "roasts") return roastSelectMock();
      throw new Error(`unexpected maybeSingle() on table "${builder._table}"`);
    },
    then: (resolve) => {
      if (builder._table === "messages") return resolve(historySelectMock());
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

const { persistChatTurnMock } = vi.hoisted(() => ({
  persistChatTurnMock: vi.fn(async () => ({ userMessageId: "m-user", assistantMessageId: "m-assistant" })),
}));
vi.mock("./_lib/persistChatTurn.js", () => ({
  persistChatTurn: persistChatTurnMock,
}));

// No live model calls — createCompletionMock is configured per test, either to reject
// (error-path tests) or to resolve with a fake async-iterable stream (happy-path tests),
// matching roast.test.js's own approach.
const { createCompletionMock } = vi.hoisted(() => ({
  createCompletionMock: vi.fn(async () => {
    throw new Error("mock OpenAI client: no real network calls in tests");
  }),
}));
vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args) => createCompletionMock(...args) } };
  },
}));

function fakeStream(textChunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of textChunks) {
        yield { choices: [{ delta: { content: text } }] };
      }
    },
  };
}

const { default: handler, CHAT_CONTEXT_MESSAGE_LIMIT } = await import("./messages.js");
const { MAX_INPUT_LENGTH } = await import("./roast.js");
const { PERSONAS } = await import("./_lib/prompts/personas.js");
const { CHAT_BASE_FRAGMENT_WITH_PROFILE, CHAT_BASE_FRAGMENT_NO_PROFILE } = await import("./_lib/prompts/fragments.js");

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    written: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    write(chunk) {
      this.written.push(chunk);
    },
    end() {
      this.ended = true;
    },
    flushHeaders() {},
  };
}

function parseSseEvents(res) {
  const raw = res.written.join("");
  return raw
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const [eventLine, dataLine] = frame.split("\n");
      return { event: eventLine.replace("event: ", ""), data: JSON.parse(dataLine.replace("data: ", "")) };
    });
}

function req({ authorization, body } = {}) {
  return { method: "POST", body, headers: authorization ? { authorization } : {}, socket: { remoteAddress: "127.0.0.1" } };
}

function resetAllMocks() {
  createRatelimitMock.mockClear();
  getAuthenticatedUserMock.mockReset();
  getAuthenticatedUserMock.mockResolvedValue(null);
  getSupabaseClientForUserMock.mockReset();
  conversationSelectMock.mockReset();
  conversationSelectMock.mockReturnValue({ data: { id: "conv-1", persona: "cynic", roast_id: "roast-1" }, error: null });
  roastSelectMock.mockReset();
  roastSelectMock.mockReturnValue({
    data: { roast: "You are pathetic.", tips: ["Fix your bio."], profile_data: null, profile_data_expires_at: null },
    error: null,
  });
  historySelectMock.mockReset();
  historySelectMock.mockReturnValue({ data: [], error: null });
  persistChatTurnMock.mockReset();
  persistChatTurnMock.mockResolvedValue({ userMessageId: "m-user", assistantMessageId: "m-assistant" });
  createCompletionMock.mockReset();
  createCompletionMock.mockRejectedValue(new Error("mock OpenAI client: no real network calls in tests"));
}

describe("POST /api/messages", () => {
  afterEach(resetAllMocks);

  it("rejects an anonymous request with SIGN_IN_REQUIRED (401), never touching the client", async () => {
    const res = createMockRes();

    await handler(req({ body: { conversationId: "conv-1", content: "hi" } }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("SIGN_IN_REQUIRED");
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("rejects missing conversationId or content with MISSING_INPUT (400)", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1" } }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("MISSING_INPUT");
    expect(getSupabaseClientForUserMock).not.toHaveBeenCalled();
  });

  it("returns CONVERSATION_NOT_FOUND (404) for a conversation that doesn't exist or isn't the caller's", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationSelectMock.mockReturnValue({ data: null, error: null });
    const res = createMockRes();

    await handler(
      req({ authorization: "Bearer real-user-token", body: { conversationId: "someone-elses", content: "hi" } }),
      res
    );

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("CONVERSATION_NOT_FOUND");
    expect(getSupabaseClientForUserMock).toHaveBeenCalledWith("real-user-token");
    expect(createCompletionMock).not.toHaveBeenCalled();
  });

  it("locks the persona to the conversation's own persona — a client-supplied persona in the body is ignored", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    conversationSelectMock.mockReturnValue({ data: { id: "conv-1", persona: "recruiter", roast_id: "roast-1" }, error: null });
    createCompletionMock.mockResolvedValue(fakeStream(["Sure, "]));
    const res = createMockRes();

    await handler(
      req({
        authorization: "Bearer real-user-token",
        body: { conversationId: "conv-1", content: "tell me more", persona: "desi-uncle" },
      }),
      res
    );

    expect(createCompletionMock).toHaveBeenCalledTimes(1);
    const params = createCompletionMock.mock.calls[0][0];
    const systemMessage = params.messages.find((m) => m.role === "system").content;
    expect(systemMessage).toContain(PERSONAS.recruiter.promptFragment);
    expect(systemMessage).not.toContain(PERSONAS["desi-uncle"].promptFragment);
  });

  it("includes fresh (non-expired) profile data in the system prompt, fenced, and picks the with-profile base fragment", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const futureExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    roastSelectMock.mockReturnValue({
      data: {
        roast: "You are pathetic.",
        tips: ["Fix your bio."],
        profile_data: "GitHub Profile: octocat\nTop 10 repositories:\n1. Hello-World",
        profile_data_expires_at: futureExpiry,
      },
      error: null,
    });
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "what about my other repos?" } }), res);

    const params = createCompletionMock.mock.calls[0][0];
    const systemMessage = params.messages.find((m) => m.role === "system").content;
    expect(systemMessage).toContain(CHAT_BASE_FRAGMENT_WITH_PROFILE);
    expect(systemMessage).not.toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
    expect(systemMessage).toContain("GitHub Profile: octocat\nTop 10 repositories:\n1. Hello-World");
    // Fenced, not dropped in raw — two independent fenced blocks (roast, profile data).
    const fenceOpenings = systemMessage.match(/<<<PROFILE_DATA_[0-9a-f]+>>>/g) || [];
    expect(fenceOpenings.length).toBe(2);
  });

  it("falls back to roast-only context (no-profile fragment) for an expired roast, without erroring", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const pastExpiry = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    roastSelectMock.mockReturnValue({
      data: {
        roast: "You are pathetic.",
        tips: ["Fix your bio."],
        profile_data: "GitHub Profile: octocat",
        profile_data_expires_at: pastExpiry,
      },
      error: null,
    });
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "what about my other repos?" } }), res);

    expect(res.statusCode).toBe(200); // headers already committed via SSE — never a 500
    const events = parseSseEvents(res);
    expect(events.find((e) => e.event === "error")).toBeUndefined();
    const params = createCompletionMock.mock.calls[0][0];
    const systemMessage = params.messages.find((m) => m.role === "system").content;
    expect(systemMessage).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
    expect(systemMessage).not.toContain("GitHub Profile: octocat");
  });

  it("falls back to roast-only context for a linkedin/resume roast, which never has profile_data at all", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    roastSelectMock.mockReturnValue({
      data: { roast: "You are pathetic.", tips: ["Fix your bio."], profile_data: null, profile_data_expires_at: null },
      error: null,
    });
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);

    const params = createCompletionMock.mock.calls[0][0];
    const systemMessage = params.messages.find((m) => m.role === "system").content;
    expect(systemMessage).toContain(CHAT_BASE_FRAGMENT_NO_PROFILE);
  });

  it("truncates profile data to MAX_INPUT_LENGTH before it reaches the model", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const oversized = "a".repeat(MAX_INPUT_LENGTH + 500);
    roastSelectMock.mockReturnValue({
      data: {
        roast: "You are pathetic.",
        tips: [],
        profile_data: oversized,
        profile_data_expires_at: new Date(Date.now() + 10000).toISOString(),
      },
      error: null,
    });
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);

    const params = createCompletionMock.mock.calls[0][0];
    const systemMessage = params.messages.find((m) => m.role === "system").content;
    const fencedProfileBlock = systemMessage.match(/<<<PROFILE_DATA_([0-9a-f]+)>>>\n(a+)\n<<<END_PROFILE_DATA_\1>>>/);
    expect(fencedProfileBlock).not.toBeNull();
    expect(fencedProfileBlock[2].length).toBe(MAX_INPUT_LENGTH);
  });

  it("caps the context sent to the model at CHAT_CONTEXT_MESSAGE_LIMIT prior messages, oldest of the kept ones first", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    // More history than the cap — the mock simulates the real query's own `order(desc)
    // .limit(N)`, returning only the N most recent, newest first (same as the real
    // Supabase call the handler makes).
    const totalHistory = CHAT_CONTEXT_MESSAGE_LIMIT + 10;
    const newestFirst = Array.from({ length: CHAT_CONTEXT_MESSAGE_LIMIT }, (_, i) => ({
      role: i % 2 === 0 ? "assistant" : "user",
      content: `message-${totalHistory - i}`,
      created_at: `2026-09-16T00:${String(59 - i).padStart(2, "0")}:00Z`,
    }));
    historySelectMock.mockReturnValue({ data: newestFirst, error: null });
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "new message" } }), res);

    const params = createCompletionMock.mock.calls[0][0];
    // system + CHAT_CONTEXT_MESSAGE_LIMIT prior + the new message itself.
    expect(params.messages).toHaveLength(1 + CHAT_CONTEXT_MESSAGE_LIMIT + 1);
    // Chronological order restored: the oldest kept message comes right after the system
    // prompt, and the brand-new message is always last.
    expect(params.messages[1].content).toBe(newestFirst[newestFirst.length - 1].content);
    expect(params.messages[params.messages.length - 1]).toEqual({ role: "user", content: "new message" });
  });

  it("streams the reply over SSE and persists both the user message and the reply on success", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    createCompletionMock.mockResolvedValue(fakeStream(["Still ", "pathetic."]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "roast me again" } }), res);

    expect(res.headers["Content-Type"]).toBe("text/event-stream");
    const events = parseSseEvents(res);
    const messageEvents = events.filter((e) => e.event === "message");
    expect(messageEvents.map((e) => e.data.text)).toEqual(["Still ", "Still pathetic."]);
    const completeEvent = events.find((e) => e.event === "complete");
    expect(completeEvent.data).toMatchObject({ text: "Still pathetic.", messageId: "m-assistant" });
    expect(persistChatTurnMock).toHaveBeenCalledWith({
      conversationId: "conv-1",
      userContent: "roast me again",
      assistantContent: "Still pathetic.",
    });
    expect(res.ended).toBe(true);
  });

  it("sends an error SSE frame (not a crash) when the model returns an empty response", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    createCompletionMock.mockResolvedValue(fakeStream([]));
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);

    const events = parseSseEvents(res);
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent.data.error.code).toBe("LLM_EMPTY_RESPONSE");
    expect(persistChatTurnMock).not.toHaveBeenCalled();
  });

  it("returns a real 502 envelope (not SSE) when the model call itself fails to start", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = createMockRes();
      await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);

      expect(res.statusCode).toBe(502);
      expect(res.body.error.code).toBe("LLM_UPSTREAM_FAILURE");
      expect(res.headers["Content-Type"]).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("uses its own 'chat' rate-limit tier, keyed by user id", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-42" });
    const res = createMockRes();

    await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);

    expect(createRatelimitMock).toHaveBeenCalledWith("chat");
  });

  it("skips rate limiting entirely in development, same bypass as api/roast.js", async () => {
    getAuthenticatedUserMock.mockResolvedValue({ id: "user-1" });
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    createCompletionMock.mockResolvedValue(fakeStream(["ok"]));

    try {
      const res = createMockRes();
      await handler(req({ authorization: "Bearer real-user-token", body: { conversationId: "conv-1", content: "hi" } }), res);
      expect(createRatelimitMock).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
