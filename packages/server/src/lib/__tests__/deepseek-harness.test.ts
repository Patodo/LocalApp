import { afterEach, describe, expect, it, vi } from "vitest";

function sse(chunks: unknown[]) {
  const text = chunks.map((v) => `data: ${JSON.stringify(v)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { headers: { "Content-Type": "text/event-stream" } });
}
const config = { llmApiKey: "test-key", llmBaseUrl: "http://model.test/v1", llmModel: "test-model" };
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek Harness integration", () => {
  it("runs the real harness loop, executes a browser tool, and retains follow-up history", async () => {
    const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
    const requests: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      requests.push(JSON.parse(init.body));
      if (requests.length === 1) return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "createTodo", arguments: '{"title":"hello"}' } }] }, finish_reason: "tool_calls" }] }]);
      return sse([{ choices: [{ delta: { content: "完成" }, finish_reason: "stop" }] }]);
    }));
    const harness = new DeepSeekHarness(config);
    const events: any[] = [];
    const input = { sessionId: "test-session", prompt: "添加待办", systemPrompt: "帮助用户", tools: [{ name: "createTodo", description: "Create todo", parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } }] };
    try {
      await harness.run("user1", input, (event: any) => {
        events.push(event);
        if (event.type === "tool_call") {
          expect(harness.result("user2", event.token, { id: "wrong" })).toBe(false);
          expect(harness.result("user1", event.token, { id: "todo1", title: event.args.title })).toBe(true);
          expect(harness.result("user1", event.token, {})).toBe(false);
        }
      }, new AbortController().signal);
      expect(requests).toHaveLength(2);
      expect(requests[1].messages.some((m: any) => m.role === "tool" && m.tool_call_id === "call-1" && m.content.includes("todo1"))).toBe(true);
      expect(events.some((e) => e.type === "text_delta" && e.text === "完成")).toBe(true);
      expect(events.at(-1).type).toBe("done");
      await harness.run("user1", { ...input, prompt: "继续" }, () => {}, new AbortController().signal);
      expect(requests[2].messages.filter((m: any) => m.role === "user").length).toBe(2);
      await expect(harness.run("user2", input, () => {}, new AbortController().signal)).rejects.toThrow("another user");
    } finally { await harness.close(); }
  });

  it("cancels a pending tool when the browser disconnects", async () => {
    const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "cancel-call", function: { name: "wait", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }])));
    const harness = new DeepSeekHarness(config);
    const controller = new AbortController();
    let token = "";
    try {
      await harness.run("user", { sessionId: "cancel-session", prompt: "wait", systemPrompt: "", tools: [{ name: "wait", description: "wait", parameters: { type: "object", properties: {} } }] }, (event: any) => {
        if (event.type === "tool_call") { token = event.token; controller.abort(); }
      }, controller.signal);
      expect(token).not.toBe("");
      expect(harness.result("user", token, {})).toBe(false);
    } finally { await harness.close(); }
  });
});

 it("delivers a later background turn through the independent browser connection", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const { createUserMessage } = await import("@deepseek-ai/dsh-llm");
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    calls++;
    return calls === 2 ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: "background-call", function: { name: "pageTool", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }]) : sse([{ choices: [{ delta: { content: "finished" }, finish_reason: "stop" }] }]);
  }));
  const harness = new DeepSeekHarness(config);
  const foreground: any[] = [], background: any[] = [];
  const unsubscribe = harness.subscribe("background-session", (event: any) => {
    background.push(event);
    if (event.type === "tool_call") expect(harness.result("owner", event.token, { saved: true })).toBe(true);
  });
  const secondary: any[] = [];
  const secondUnsubscribe = harness.subscribe("background-session", (event) => secondary.push(event));
  try {
    await harness.run("owner", { sessionId: "background-session", prompt: "first", systemPrompt: "", tools: [{ name: "pageTool", description: "Page tool", parameters: { type: "object", properties: {} } }] }, (event) => foreground.push(event), new AbortController().signal);
    expect(background).toHaveLength(0);
    const agent = (harness as any).conversations.get("background-session").handle.agent;
    agent.followup(createUserMessage({ content: [{ type: "text", text: "background" }], source: { kind: "user" } }));
    await agent.whenIdle();
    expect(background.some((event) => event.type === "tool_call")).toBe(true);
    expect(background.some((event) => event.type === "messages" && JSON.stringify(event.messages).includes("saved"))).toBe(true);
    expect(foreground.at(-1).type).toBe("done");
    expect(secondary.some((event) => event.type === "tool_call")).toBe(false);
  } finally { secondUnsubscribe(); unsubscribe(); await harness.close(); }
 });

it("generates and persists development conversation titles without leaking title text into chat", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve("../../tmp/platform-development/title-harness-test");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "session-"));
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const naming = body.messages.some((message: any) => message.role === "system" && /title/i.test(message.content));
    return sse([{ choices: [{ delta: { content: naming ? "工作项筛选" : "已完成页面修改" }, finish_reason: "stop" }] }]);
  }));
  const options = { ...config, root: directory, autoSessionTitles: true };
  const harness = new DeepSeekHarness(options);
  const events: any[] = [];
  try {
    await harness.run("owner", { sessionId: "named-session", prompt: "给工作项增加状态筛选", systemPrompt: "帮助开发应用", tools: [] }, event => events.push(event), new AbortController().signal);
    await vi.waitFor(async () => expect((await harness.listSessions())[0].title).toBe("工作项筛选"));
    expect(events.some(event => event.type === "session_title" && event.title === "工作项筛选")).toBe(true);
    expect(events.filter(event => event.type === "text_delta").map(event => event.text).join("")).toBe("已完成页面修改");
    expect(JSON.stringify(await harness.history("named-session"))).not.toContain("工作项筛选");
    await harness.run("owner", { sessionId: "named-session", prompt: "继续", systemPrompt: "帮助开发应用", tools: [] }, () => {}, new AbortController().signal);
    expect(requests).toHaveLength(3);
  } finally { await harness.close(); }
  const restored = new DeepSeekHarness(options);
  try { expect((await restored.listSessions())[0].title).toBe("工作项筛选"); }
  finally { await restored.close(); await fs.rm(directory, { recursive: true, force: true }); }
});
