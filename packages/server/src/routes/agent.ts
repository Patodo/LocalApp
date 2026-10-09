import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { AgentSettingsStore, AGENT_CAPABILITIES } from "../lib/agent-settings.js";
import { resolveAgentApp } from "../lib/agent-app.js";

export async function agentRoutes(app: FastifyInstance) {
  const { DeepSeekHarness } = await import("../lib/deepseek-harness.mjs");
  const settings = new AgentSettingsStore(app.config.dataDir);
  const runtimes = new Map<string, { userId: string; fingerprint: string; harness: InstanceType<typeof DeepSeekHarness> }>();
  const opening = new Map<string, Promise<InstanceType<typeof DeepSeekHarness>>>();
  app.addHook("preClose", async () => { await Promise.all([...runtimes.values()].map((r) => r.harness.close())); });
  app.addHook("onClose", async () => { await Promise.all([...opening.values()].map((p) => p.catch(() => undefined))); await Promise.all([...runtimes.values()].map((r) => r.harness.close())); });
  const runtime = async (userId: string, appId?: string, providerId?: string) => {
    const application = resolveAgentApp(app.config.dataDir, userId, appId);
    const saved = settings.read(userId);
    const provider = saved.providers.find((p) => p.id === (providerId || saved.defaultProviderId));
    if (!provider) throw new Error("请先在模型与 Agent 设置中配置供应商和默认模型");
    const capabilities = application.capabilities.filter((c) => saved.grants[application.id]?.includes(c));
    const key = JSON.stringify([userId, application.id, provider.id]);
    if (opening.has(key)) { await opening.get(key); return runtime(userId, appId, providerId); }
    const fingerprint = createHash("sha256").update(JSON.stringify([provider, capabilities, saved.mcpServers])).digest("hex");
    const old = runtimes.get(key);
    if (old?.fingerprint === fingerprint) return old.harness;
    if (!old && runtimes.size >= 100) throw new Error("Agent capacity reached");
    const pending = (async () => {
      if (old) { runtimes.delete(key); await old.harness.close(); }
      const root = path.join(app.config.dataDir, "agent", createHash("sha256").update(key).digest("hex"));
      const harness = new DeepSeekHarness({ llmApiKey: provider.apiKey, llmBaseUrl: provider.baseUrl, llmModel: provider.model, protocol: provider.protocol, ownerId: userId, root, capabilities, mcpServers: saved.mcpServers });
      try { await harness.initialize(); }
      catch (error) { await harness.close().catch(() => {}); throw error; }
      runtimes.set(key, { userId, fingerprint, harness });
      return harness;
    })();
    opening.set(key, pending);
    try { return await pending; } finally { opening.delete(key); }
  };
  const restoreSchedules = async (onlyUser?: string) => {
    for (const userId of onlyUser ? [onlyUser] : settings.users()) {
      const saved = settings.read(userId);
      for (const [appId, grants] of Object.entries(saved.grants)) {
        if (!grants.includes("schedule")) continue;
        for (const provider of saved.providers) {
          const key = JSON.stringify([userId, appId, provider.id]);
          if (!fs.existsSync(path.join(app.config.dataDir, "agent", createHash("sha256").update(key).digest("hex")))) continue;
          try { await runtime(userId, appId, provider.id); }
          catch { app.log.warn({ userId, appId }, "Agent scheduled work could not be restored"); }
        }
      }
    }
  };
  await restoreSchedules();
  app.get("/api/agent/settings", async (req) => ({ success: true, data: { ...settings.publicSettings(req.userId), settingsUrl: `${(app.config.publicUrl || `${req.protocol}://${req.headers.host}`).replace(/\/$/, "")}/my/models/` }, capabilities: AGENT_CAPABILITIES }));
  app.put("/api/agent/settings", async (req, reply) => {
    try {
      const data = settings.write(req.userId, req.body);
      await Promise.all([...opening.values()].map((p) => p.catch(() => undefined)));
      for (const [key, value] of runtimes) if (value.userId === req.userId) { runtimes.delete(key); await value.harness.close(); }
      await restoreSchedules(req.userId);
      return { success: true, data };
    } catch (error) { return reply.status(400).send({ success: false, error: error instanceof Error ? error.message : "Invalid settings" }); }
  });
  app.get<{ Querystring: { appId?: string; providerId?: string } }>("/api/agent/sessions", async (req, reply) => {
    try { return { success: true, data: await (await runtime(req.userId, req.query.appId, req.query.providerId)).listSessions() }; }
    catch (error) { return reply.status(400).send({ success: false, error: (error as Error).message }); }
  });
  app.get<{ Params: { id: string }; Querystring: { appId?: string; providerId?: string } }>("/api/agent/sessions/:id", async (req, reply) => {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id)) return reply.status(400).send({ success: false, error: "Invalid session id" });
    try { return { success: true, data: await (await runtime(req.userId, req.query.appId, req.query.providerId)).history(req.params.id) }; }
    catch { return reply.status(404).send({ success: false, error: "Conversation not found" }); }
  });
  app.post<{ Body: { sessionId: string; appId?: string; providerId?: string } }>("/api/agent/cancel", async (req, reply) => {
    if (!req.body || typeof req.body.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(req.body.sessionId)) return reply.status(400).send({ success: false, error: "Invalid session" });
    try { return { success: (await runtime(req.userId, req.body.appId, req.body.providerId)).cancel(req.userId, req.body.sessionId) }; }
    catch (error) { return reply.status(400).send({ success: false, error: (error as Error).message }); }
  });
  app.get<{ Querystring: { sessionId: string; appId?: string; providerId?: string } }>("/api/agent/events", async (req, reply) => {
    if (typeof req.query.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(req.query.sessionId)) return reply.status(400).send({ success: false, error: "Invalid session" });
    let harness: InstanceType<typeof DeepSeekHarness>;
    try { harness = await runtime(req.userId, req.query.appId, req.query.providerId); }
    catch (error) { return reply.status(400).send({ success: false, error: (error as Error).message }); }
    let dispose: () => void;
    try { dispose = harness.subscribe(req.query.sessionId, (event: any) => { if (!reply.raw.destroyed) { reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); if (event.type === "connection_closed") reply.raw.end(); } }); }
    catch (error) { return reply.status(429).send({ success: false, error: (error as Error).message }); }
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    reply.raw.write(": connected\n\n");
    const heartbeat = setInterval(() => { if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n"); }, 15_000);
    reply.raw.on("close", () => { clearInterval(heartbeat); dispose(); });
  });
  app.post<{ Body: { token: string; result: unknown } }>("/api/agent/tool-result", async (req, reply) => {
    if (!req.body || typeof req.body.token !== "string" || ![...runtimes.values()].some((r) => r.userId === req.userId && r.harness.result(req.userId, req.body.token, req.body.result))) return reply.status(404).send({ success: false, error: "Unknown tool call" });
    return { success: true };
  });
  app.post<{ Body: import("../lib/deepseek-harness.mjs", { with: { "resolution-mode": "import" } }).HarnessInput }>("/api/agent/run", async (req, reply) => {
    const input = req.body;
    if (!input || typeof input.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(input.sessionId) || typeof input.prompt !== "string" || !input.prompt.trim() || typeof input.systemPrompt !== "string" || !Array.isArray(input.tools) || input.tools.length > 100 || input.tools.some((t) => !t || typeof t.name !== "string" || !t.name || typeof t.description !== "string" || !t.parameters || typeof t.parameters !== "object" || Array.isArray(t.parameters)) || new Set(input.tools.map((t) => t.name)).size !== input.tools.length) return reply.status(400).send({ success: false, error: "Invalid agent request" });
    let harness: InstanceType<typeof DeepSeekHarness>;
    try { harness = await runtime(req.userId, input.appId, input.providerId); }
    catch (error) { return reply.status(400).send({ success: false, error: (error as Error).message }); }
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    reply.raw.on("close", disconnect);
    const emit = (event: unknown) => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };
    try { await harness.run(req.userId, input, emit, controller.signal); }
    catch (err) { emit({ type: "error", message: err instanceof Error ? err.message : String(err) }); }
    finally { reply.raw.off("close", disconnect); reply.raw.end(); }
  });
}
