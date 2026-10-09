import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("uses the dsh multi-provider adapter for a user's Anthropic endpoint and credential", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const frames = [
    { type: "message_start", message: { id: "m1", type: "message", role: "assistant", content: [], model: "private-model", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "private response" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  }));
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const root = path.resolve(__dirname, "../../../../../tmp/dsh-provider-test", String(process.pid));
  const harness = new DeepSeekHarness({ llmApiKey: "user-anthropic-key", llmBaseUrl: "http://anthropic.test", llmModel: "private-model", protocol: "anthropic-messages", root });
  const events: any[] = [];
  try {
    await harness.run("user", { sessionId: "anthropic", prompt: "hello", systemPrompt: "app prompt", tools: [] }, (event) => events.push(event), new AbortController().signal);
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("/messages");
    expect(requests[0].headers.get("x-api-key")).toBe("user-anthropic-key");
    expect(events.at(-2).messages.at(-1).content).toContainEqual({ type: "text", text: "private response" });
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
