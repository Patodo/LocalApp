import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { registerAndLogin } from "../helpers/createUser.js";
import { AgentSettingsStore } from "../../src/lib/agent-settings.js";
import { createHash } from "node:crypto";
import { createTestPage, createTestServer } from "./helpers.js";

vi.mock("../../src/lib/system-agent-environment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/system-agent-environment.js")>();
  return { ...actual, systemAgentEnvironment: async () => ({ checkedAt: new Date().toISOString(), platform: "test", ready: false, checks: [{ id: "runner", status: "ready" }, { id: "python", status: "missing" }] }) };
});
let server: Awaited<ReturnType<typeof createTestServer>>;
let model: http.Server;
let alice: string, bob: string, modelUrl: string;
const requests: any[] = [];
const appId = "skillowner/document-app";
beforeAll(async () => {
  server = await createTestServer({ dataRoot: path.resolve(__dirname, "../../../../tmp/agent-app-settings-integration") });
  alice = await registerAndLogin(server.baseUrl, "skillowner");
  bob = await registerAndLogin(server.baseUrl, "skillreader");
  await createTestPage(server.app, "skillowner", "document-app");
  fs.writeFileSync(path.join(server.dataDir, appId, "manifest.json"), JSON.stringify({ name: "document-app", agent: { capabilities: ["skills", "files", "terminal"] } }));
  model = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
  modelUrl = `http://127.0.0.1:${(model.address() as any).port}/v1`;
}, 30_000);
afterAll(async () => { if (model) await new Promise<void>((resolve) => model.close(() => resolve())); await server?.stop(); });
const api = (cookie: string, url: string, method = "GET", body?: unknown) => fetch(`${server.baseUrl}/api/agent/${url}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
it("saves per-user choices and enforces them in a real Server/DSH model request", async () => {
  const defaultSettings = await (await api(alice, `app-settings?appId=${appId}`)).json();
  expect(defaultSettings.data.enabledSkills).toEqual([]);
  expect(defaultSettings.data.skills.map((skill: any) => skill.id)).toEqual(["markitdown", "pdf", "docx", "xlsx"]);
  expect((await api(alice, "app-tools", "POST", { appId, tools: [{ name: "deleteRecord", description: "Delete" }, { name: "listRecords", description: "List" }] })).status).toBe(200);
  expect((await api(alice, "app-settings", "PUT", { appId, enabledCapabilities: ["skills", "files"], enabledSkills: [], disabledTools: ["write", "deleteRecord"] })).status).toBe(200);
  const other = await (await api(bob, `app-settings?appId=${appId}`)).json();
  expect(other.data.enabledSkills).toEqual([]);
  expect(other.data.disabledTools).toEqual([]);
  expect(other.data.tools).toEqual([]);
  expect((await api(alice, "app-settings", "PUT", { appId, enabledCapabilities: ["web"], enabledSkills: [], disabledTools: [] })).status).toBe(400);
  expect((await api(alice, "app-settings", "PUT", { appId, enabledCapabilities: [], enabledSkills: ["../secret"], disabledTools: [] })).status).toBe(400);
  expect((await api(alice, "app-settings?appId=skillowner/missing")).status).toBe(400);
  expect((await fetch(`${server.baseUrl}/api/agent/app-settings?appId=${appId}`)).status).toBe(401);
  const previous = await (await api(alice, "settings")).json();
  expect((await api(alice, "settings", "PUT", { ...previous.data, providers: [{ id: "mock", name: "Mock", protocol: "openai-completions", baseUrl: modelUrl, model: "test", apiKey: "test" }], defaultProviderId: "mock" })).status).toBe(200);
  const run = await api(alice, "run", "POST", { appId, sessionId: "selected-tools", prompt: "Read", systemPrompt: "Application", tools: ["deleteRecord", "listRecords"].map((name) => ({ name, description: name, parameters: { type: "object", properties: {} } })) });
  expect(run.status).toBe(200);
  expect(await run.text()).toContain('"type":"done"');
  // The auxiliary naming request has no tools; inspect the application request.
  const names = [...requests].reverse().find(request => request.tools)?.tools.map((tool: any) => tool.function.name);
  expect(names).toContain("read"); expect(names).toContain("listRecords");
  expect(names).not.toContain("write"); expect(names).not.toContain("deleteRecord");
  const stored = await (await api(alice, `app-settings?appId=${appId}`)).json();
  expect(stored.data.enabledSkills).toEqual([]);
  expect(stored.data.tools.some((tool: any) => tool.name === "deleteRecord")).toBe(true);
}, 30_000);
it("limits system environment checks to admins and rejects skills with missing system dependencies", async () => {
  expect((await fetch(`${server.baseUrl}/api/system/agent-environment`)).status).toBe(401);
  expect((await fetch(`${server.baseUrl}/api/system/agent-environment`, { headers: { Cookie: alice } })).status).toBe(403);
  const admin = await server.app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "localadmin", password: "localadmin" } });
  const cookie = admin.headers["set-cookie"];
  const response = await server.app.inject({ method: "GET", url: "/api/system/agent-environment", headers: { cookie: Array.isArray(cookie) ? cookie.map(c => c.split(";")[0]).join("; ") : String(cookie).split(";")[0] } });
  expect(response.statusCode).toBe(200);
  expect(response.json().data.ready).toBe(false);
  for (const [method,url] of [["GET","/api/system/python-environment"],["PUT","/api/system/python-environment"],["POST","/api/system/python-environment/create"],["POST","/api/system/python-environment/install-document-dependencies"]] as const) {
    const denied = await server.app.inject({method,url,headers:{cookie:alice},...(method === "GET" ? {} : {payload:{}})});
    expect(denied.statusCode).toBe(403);
  }
  const available = await (await api(alice, `app-settings?appId=${appId}`)).json();
  expect(available.data.skills.every((s: any) => s.available === false)).toBe(true);
  const save = await api(alice, "app-settings", "PUT", { appId, enabledCapabilities: ["skills", "files", "terminal"], enabledSkills: ["pdf"], disabledTools: [] });
  expect(save.status).toBe(400);
  expect((await save.json()).error).toContain("系统文档处理依赖未就绪");
  // A previously saved selection must not load after system dependencies fail.
  const settings = new AgentSettingsStore(server.dataDir);
  const saved = settings.read("skillowner");
  settings.write("skillowner", { ...saved, applications: { ...saved.applications, [appId]: { ...saved.applications[appId], skills: ["pdf"] } } });
  const effective = await (await api(alice, `app-settings?appId=${appId}`)).json();
  expect(effective.data.enabledSkills).toEqual([]);
  const run = await api(alice, "run", "POST", { appId, sessionId: "missing-system-dependencies", prompt: "Read", systemPrompt: "Application", tools: [] });
  expect(await run.text()).toContain('"type":"done"');
  const root = createHash("sha256").update(JSON.stringify(["skillowner", appId, "mock"])).digest("hex");
  expect(fs.existsSync(path.join(server.dataDir, "agent", root, "workspace/.localapp-public-skills/pdf"))).toBe(false);
});
