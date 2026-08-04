import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { closeMetaDb, BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { storagePlugin } from "../../src/plugins/storage.js";
import { authPlugin } from "../../src/plugins/auth.js";
import { authRoutes } from "../../src/routes/auth.js";
import { serveRoutes } from "../../src/routes/serve.js";
import { schemasRoutes } from "../../src/routes/schemas.js";
import { uploadRoutes } from "../../src/routes/upload.js";
import { pagesRoutes } from "../../src/routes/pages.js";
import { keysRoutes } from "../../src/routes/keys.js";
import { configRoutes } from "../../src/routes/config.js";
import { llmRoutes } from "../../src/routes/llm.js";

/** Build SSE chunks for a mock LLM response that calls a tool */
function buildToolCallSSE(toolName: string, toolArgs: Record<string, string>): string {
  const argsJson = JSON.stringify(toolArgs);
  const lines: string[] = [];

  lines.push(`data: ${JSON.stringify({
    id: "mock-001", object: "chat.completion.chunk", created: Date.now(),
    model: "mock-llm", choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }],
  })}`);

  // tool_call start with name
  lines.push(`data: ${JSON.stringify({
    id: "mock-001", object: "chat.completion.chunk", created: Date.now(),
    model: "mock-llm", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_mock_0", type: "function", function: { name: toolName, arguments: "" } }] }, finish_reason: null }],
  })}`);

  // tool_call argument chunks
  for (const char of argsJson) {
    lines.push(`data: ${JSON.stringify({
      id: "mock-001", object: "chat.completion.chunk", created: Date.now(),
      model: "mock-llm", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: char } }] }, finish_reason: null }],
    })}`);
  }

  // finish with tool_calls
  lines.push(`data: ${JSON.stringify({
    id: "mock-001", object: "chat.completion.chunk", created: Date.now(),
    model: "mock-llm", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  })}`);

  lines.push("data: [DONE]");
  return lines.join("\n\n") + "\n\n";
}

/** Build SSE chunks for a text-only response */
function buildTextSSE(text: string): string {
  const lines: string[] = [];
  lines.push(`data: ${JSON.stringify({
    id: "mock-002", object: "chat.completion.chunk", created: Date.now(),
    model: "mock-llm", choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }],
  })}`);

  for (const char of text) {
    lines.push(`data: ${JSON.stringify({
      id: "mock-002", object: "chat.completion.chunk", created: Date.now(),
      model: "mock-llm", choices: [{ index: 0, delta: { content: char }, finish_reason: null }],
    })}`);
  }

  lines.push(`data: ${JSON.stringify({
    id: "mock-002", object: "chat.completion.chunk", created: Date.now(),
    model: "mock-llm", choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}`);

  lines.push("data: [DONE]");
  return lines.join("\n\n") + "\n\n";
}

/** Create a mock LLM upstream server */
async function createMockLlmServer(): Promise<{ app: FastifyInstance; baseUrl: string; receivedRequests: () => any[]; cleanup: () => Promise<void> }> {
  const requests: any[] = [];
  const app = Fastify();

  app.post("/chat/completions", async (req, reply) => {
    const body = typeof req.body === "object" ? req.body : {};
    requests.push(body);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const tools = (body as any).tools;
    if (tools && tools.length > 0) {
      // Has tools → respond with a tool_call
      const toolFn = tools[0].function;
      const toolName = toolFn.name;
      const props = toolFn.parameters?.properties || {};
      const mockArgs: Record<string, string> = {};
      for (const [key] of Object.entries(props)) {
        mockArgs[key] = `mock_${key}`;
      }
      reply.raw.write(buildToolCallSSE(toolName, mockArgs));
    } else {
      // No tools → text response
      reply.raw.write(buildTextSSE("I received your message."));
    }

    reply.raw.end();
    return await reply;
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.addresses()[0];
  if (!addr || typeof addr === "string") throw new Error("Mock server not listening");

  return {
    app,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    receivedRequests: () => requests,
    cleanup: () => app.close(),
  };
}

/** Create a test env with LLM routes pointed at mock upstream */
async function createLlmTestEnv(mockBaseUrl: string): Promise<{ baseUrl: string; apiKey: string; userId: string; dataDir: string; app: FastifyInstance; cleanup: () => Promise<void> }> {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-llm-test-"));

  process.env.DATA_DIR = dataDir;
  process.env.BOOTSTRAP_API_KEY = "llm-test-key";
  process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";
  process.env.LLM_API_KEY = "mock-api-key";
  process.env.LLM_MODEL = "mock-llm";
  process.env.LLM_BASE_URL = mockBaseUrl;

  const app: FastifyInstance = Fastify({ ignoreTrailingSlash: true });

  await app.register(storagePlugin);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.register(authRoutes);
  app.register(serveRoutes);

  app.register(async (authScope) => {
    await authPlugin(authScope);
    authScope.register(keysRoutes);
    authScope.register(configRoutes);
    authScope.register(uploadRoutes);
    authScope.register(pagesRoutes);
    authScope.register(schemasRoutes);
  });

  // Register LLM routes with auth
  app.register(async (authScope) => {
    await authPlugin(authScope);
    authScope.register(llmRoutes);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.addresses()[0];
  if (!addr || typeof addr === "string") throw new Error("Server not listening");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    apiKey: "llm-test-key",
    userId: BOOTSTRAP_USER_ID,
    dataDir,
    app,
    cleanup: async () => {
      await app.close();
      closeMetaDb();
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    },
  };
}

describe("llm-proxy-e2e", () => {
  let mockLlm: Awaited<ReturnType<typeof createMockLlmServer>>;
  let env: Awaited<ReturnType<typeof createLlmTestEnv>>;

  beforeAll(async () => {
    mockLlm = await createMockLlmServer();
    env = await createLlmTestEnv(mockLlm.baseUrl);
  });

  afterAll(async () => {
    await mockLlm.cleanup();
    await env.cleanup();
  });

  it("should forward tools parameter to upstream LLM", async () => {
    const tools = [
      { type: "function", function: { name: "submitLeave", description: "Submit leave", parameters: { type: "object", required: ["name"], properties: { name: { type: "string", description: "Name" } } } } },
    ];
    const res = await fetch(`${env.baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helper." },
          { role: "user", content: "Submit leave for John" },
        ],
        tools,
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();

    // Verify mock received tools
    const requests = mockLlm.receivedRequests();
    const lastReq = requests[requests.length - 1];
    expect(lastReq.tools).toBeDefined();
    expect(lastReq.tools.length).toBe(1);
    expect(lastReq.tools[0].function.name).toBe("submitLeave");
    expect(lastReq.stream).toBe(true);
    expect(lastReq.model).toBe("mock-llm");

    // Verify SSE response contains tool_calls
    expect(text).toContain("tool_calls");
    expect(text).toContain("submitLeave");
    expect(text).toContain("finish_reason");
    expect(text).toContain("[DONE]");
  });

  it("should work without tools (text-only response)", async () => {
    const res = await fetch(`${env.baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();

    // No tools sent → text response
    const requests = mockLlm.receivedRequests();
    const lastReq = requests[requests.length - 1];
    expect(lastReq.tools).toBeUndefined();
    expect(text).toContain('"content":"I"');
    expect(text).toContain('"content":"."');
    expect(text).toContain('"finish_reason":"stop"');
  });

  it("should reject requests without messages", async () => {
    const res = await fetch(`${env.baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.apiKey,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("messages");
  });

  it("should require authentication", async () => {
    const res = await fetch(`${env.baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(res.status).toBe(401);
  });

  it("should forward tool_result in multi-turn conversation", async () => {
    const res = await fetch(`${env.baseUrl}/api/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.apiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helper." },
          { role: "user", content: "Submit leave for John" },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "submitLeave", arguments: '{"name":"John"}' } }] },
          { role: "tool", content: '{"success":true}', tool_call_id: "call_1" },
          { role: "user", content: "Thanks!" },
        ],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);

    // Verify mock received the full message history with correct format
    const requests = mockLlm.receivedRequests();
    const lastReq = requests[requests.length - 1];
    expect(lastReq.messages.length).toBe(5);

    // assistant message should have tool_calls
    const assistantMsg = lastReq.messages[2];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.tool_calls).toBeDefined();
    expect(assistantMsg.tool_calls[0].function.name).toBe("submitLeave");

    // tool result should have tool_call_id
    const toolMsg = lastReq.messages[3];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_1");
  });
});
