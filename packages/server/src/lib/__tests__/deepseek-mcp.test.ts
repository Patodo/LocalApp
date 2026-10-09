import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi, afterEach } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("connects the user's MCP server and executes its discovered tool through dsh", async () => {
  const auth: Array<string | undefined> = [];
  const mcp = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    let body = ""; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    auth.push(req.headers.authorization);
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "inventory", version: "1" } }
      : message.method === "tools/list" ? { tools: [{ name: "lookup", description: "Find SKU", inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } }] }
      : message.method === "tools/call" ? { content: [{ type: "text", text: `Inventory ${message.params.arguments.sku}` }] } : {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (!String(url).startsWith("http://model.test")) return originalFetch(url, init);
    const request = JSON.parse(init.body); requests.push(request);
    const call = request.messages.at(-1)?.role !== "tool";
    const delta = call ? { tool_calls: [{ index: 0, id: "inventory-call", function: { name: "mcp__inventory__lookup", arguments: '{"sku":"A1"}' } }] } : { content: "Found inventory" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const root = path.resolve(__dirname, "../../../../../tmp/dsh-mcp-test", String(process.pid));
  const harness = new DeepSeekHarness({ llmApiKey: "model-key", llmBaseUrl: "http://model.test/v1", llmModel: "model", root, capabilities: ["mcp"], mcpServers: [{ serverName: "inventory", url: `http://127.0.0.1:${(mcp.address() as any).port}/mcp`, headers: { Authorization: "Bearer user-mcp-key" } }] });
  const events: any[] = [];
  try {
    await harness.run("user", { sessionId: "mcp", prompt: "lookup A1", systemPrompt: "Use inventory", tools: [] }, (event) => events.push(event), new AbortController().signal);
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(requests[1].messages.at(-1).content).toContain("Inventory A1");
    expect(auth.length).toBeGreaterThanOrEqual(3);
    expect(auth.every((value) => value === "Bearer user-mcp-key")).toBe(true);
  } finally {
    await harness.close();
    await new Promise<void>((resolve) => mcp.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
}, 30_000);
