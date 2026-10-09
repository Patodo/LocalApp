import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi, afterEach } from "vitest";
const root = path.resolve(__dirname, "../../../../../tmp/dsh-capabilities-test", String(process.pid));
it("mounts the application capability set and persists a real Harness conversation", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "model", root, capabilities: ["files", "terminal", "skills", "subagents", "jobs", "web", "workflow", "schedule"] });
  try {
    await harness.initialize();
    const ctx = (harness as any).ctx;
    const names = ctx.tools.schemas().map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(["read", "write", "glob", "grep", "bash", "subagent", "workflow", "schedule_create"]));
    expect(ctx.get("skills")).toBeDefined();
    expect(ctx.get("jobs")).toBeDefined();
    expect(ctx.get("schedule")).toBeDefined();
    await expect(ctx.fs.resolve(path.dirname(root))).rejects.toThrow("outside");
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

afterEach(() => vi.unstubAllGlobals());
it("writes application files through the real loop and restores conversation history after restart", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const calls: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); calls.push(request);
    const tool = request.messages.at(-1)?.role !== "tool";
    const delta = tool ? { tool_calls: [{ index: 0, id: `file-${calls.length}`, function: { name: "write", arguments: JSON.stringify({ file_path: "test.txt", content: "application data" }) } }] } : { content: "saved" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const options = { llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["files"] as const };
  let harness = new DeepSeekHarness({ ...options, capabilities: [...options.capabilities] });
  try {
    await harness.run("user", { sessionId: "persisted", prompt: "write file", systemPrompt: "application prompt", tools: [] }, () => {}, new AbortController().signal);
    expect(await fs.readFile(path.join(root, "workspace/test.txt"), "utf8")).toBe("application data");
    await harness.close();
    harness = new DeepSeekHarness({ ...options, capabilities: [...options.capabilities] });
    const history = await harness.history("persisted");
    expect(history.filter((m) => m.role === "user")).toHaveLength(1);
    await harness.run("user", { sessionId: "persisted", prompt: "again", systemPrompt: "application prompt", tools: [] }, () => {}, new AbortController().signal);
    expect(calls.at(-1).messages.filter((m: any) => m.role === "user" && ["write file", "again"].includes(m.content))).toHaveLength(2);
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it("runs a confined terminal command and prevents reads of another application's files", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const secret = path.join(root, "outside-secret.txt");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(secret, "outside-application-secret");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const call = request.messages.at(-1)?.role !== "tool";
    const quoted = "'" + secret.replaceAll("'", "'\\''") + "'";
    const delta = call ? { tool_calls: [{ index: 0, id: "shell-call", function: { name: "bash", arguments: JSON.stringify({ description: "Verify application isolation", command: `printf terminal-ok > terminal.txt; cat terminal.txt; cat ${quoted}; if cat /proc/${process.pid}/environ >/dev/null 2>&1; then printf server-env-readable; else printf server-env-denied; fi` }) } }] } : { content: "finished" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["terminal"] });
  try {
    await harness.run("user", { sessionId: "terminal", prompt: "execute", systemPrompt: "", tools: [] }, () => {}, new AbortController().signal);
    expect(requests.at(-1).messages.at(-1).content).not.toContain("outside-application-secret");
    expect(requests.at(-1).messages.at(-1).content).toContain("terminal-ok");
    expect(requests.at(-1).messages.at(-1).content).toContain("server-env-denied");
    expect(await fs.readFile(path.join(root, "workspace/terminal.txt"), "utf8").catch(() => undefined), requests.at(-1).messages.at(-1).content).toBe("terminal-ok");
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it("delegates to a real child Agent that uses the registered application tool", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const child = request.messages.some((m: any) => m.role === "user" && m.content?.includes("child task"));
    const call = request.messages.at(-1)?.role !== "tool";
    const name = child ? "pageAction" : "subagent";
    const args = child ? {} : { description: "Do child task", prompt: "child task", run_in_background: false };
    const delta = call ? { tool_calls: [{ index: 0, id: `delegate-${requests.length}`, function: { name, arguments: JSON.stringify(args) } }] } : { content: "finished" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "user-key", llmBaseUrl: "http://model.test/v1", llmModel: "user-model", root, capabilities: ["subagents"] });
  let actions = 0;
  try {
    await harness.run("user", { sessionId: "delegate", prompt: "delegate", systemPrompt: "App prompt", tools: [{ name: "pageAction", description: "Application action", parameters: { type: "object", properties: {} } }] }, (event: any) => {
      if (event.type === "tool_call") { actions++; harness.result("user", event.token, { appSaved: true }); }
    }, new AbortController().signal);
    expect(actions, JSON.stringify(requests.map((r) => ({messages:r.messages,tools:r.tools.map((t: any) => t.function.name)})))).toBe(1);
    expect(requests.every((request) => request.model === "user-model")).toBe(true);
    expect(requests.some((request) => request.messages.some((m: any) => m.role === "tool" && m.content.includes("appSaved")))).toBe(true);
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

it("searches application files with a confined ripgrep process", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  await fs.mkdir(path.join(root, "workspace"), { recursive: true });
  await fs.writeFile(path.join(root, "workspace/search.txt"), "search-content\n");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const call = request.messages.at(-1)?.role !== "tool";
    const delta = call ? { tool_calls: [{ index: 0, id: "search", function: { name: "grep", arguments: JSON.stringify({ pattern: "search-content" }) } }] } : { content: "done" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["files"] });
  try {
    await harness.run("user", { sessionId: "search-session", prompt: "search", systemPrompt: "", tools: [] }, () => {}, new AbortController().signal);
    expect(requests.at(-1).messages.at(-1).content).toContain("search.txt");
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it.each([
  { name: "workflow", capabilities: ["workflow"], args: { script: "return { answer: 42 };", meta: { name: "test-workflow", description: "Verify isolated workflow" } }, expected: "42" },
  { name: "skill", capabilities: ["skills"], args: { name: "test-skill" }, expected: "skill-instructions-marker" },
  { name: "ask_user_question", capabilities: [], args: { questions: [{ id: "choice", question: "Choose", options: [{ label: "yes" }] }] }, expected: "yes" },
])("executes the real $name tool", async ({ name, capabilities, args, expected }) => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  await fs.mkdir(path.join(root, "workspace/skills/test-skill"), { recursive: true });
  await fs.writeFile(path.join(root, "workspace/skills/test-skill/SKILL.md"), "---\nname: test-skill\ndescription: Test skill\n---\nskill-instructions-marker\n");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const call = request.messages.at(-1)?.role !== "tool";
    const delta = call ? { tool_calls: [{ index: 0, id: "capability-call", function: { name, arguments: JSON.stringify(args) } }] } : { content: "done" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: capabilities as any });
  try {
    await harness.run("user", { sessionId: "capability-session", prompt: "execute capability", systemPrompt: "", tools: [] }, (event: any) => {
      if (event.type === "interaction") harness.result("user", event.token, { answers: [{ id: "choice", selected: ["yes"], custom: "" }] });
    }, new AbortController().signal);
    expect(requests.at(-1).messages.at(-1).content).toContain(expected);
    if (name === "workflow") expect(requests[0].tools.some((tool: any) => tool.function.name === "subagent")).toBe(false);
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it("delivers a scheduled message through the live Agent after its foreground turn", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const call = requests.length === 1;
    const delta = call ? { tool_calls: [{ index: 0, id: "schedule-call", function: { name: "schedule_create", arguments: JSON.stringify({ title: "Test reminder", prompt: "scheduled-message-marker", after_seconds: 1 }) } }] } : { content: "done" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["schedule"], ownerId: "user" });
  try {
    await harness.run("user", { sessionId: "schedule-session", prompt: "schedule", systemPrompt: "", tools: [] }, () => {}, new AbortController().signal);
    await vi.waitFor(() => expect(requests.some((request) => request.messages.some((m: any) => m.role === "user" && m.content?.includes("scheduled-message-marker")))).toBe(true), { timeout: 5000 });
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

it("runs plan commands locally and prevents application actions while planning", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    const call = request.messages.at(-1)?.role !== "tool";
    const delta = call ? { tool_calls: [{ index: 0, id: "plan-action", function: { name: "pageAction", arguments: "{}" } }] } : { content: "done" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: [] });
  const input = { sessionId: "plan-session", prompt: "/plan", systemPrompt: "", tools: [{ name: "pageAction", description: "Write app data", parameters: { type: "object", properties: {} } }] };
  const events: any[] = [];
  try {
    await harness.run("user", input, (event) => events.push(event), new AbortController().signal);
    expect(requests).toHaveLength(0);
    expect(events.some((event) => event.type === "command_result" && event.result.kind === "success")).toBe(true);
    await harness.run("user", { ...input, prompt: "Plan" }, (event) => events.push(event), new AbortController().signal);
    expect(events.some((event) => event.type === "tool_call")).toBe(false);
    expect(requests.at(-1).messages.at(-1).content).toContain("计划模式");
    await harness.run("user", { ...input, prompt: "/plan off" }, () => {}, new AbortController().signal);
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
it("loads only selected public skills and excludes disabled tools from model requests", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const requests: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }));
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["skills", "files"], skills: ["pdf"], disabledTools: ["write"] });
  try {
    await harness.initialize();
    await harness.run("user", { sessionId: "selected-skills", prompt: "list skills", systemPrompt: "", tools: [] }, () => {}, new AbortController().signal);
    expect(requests[0].tools.map((tool: any) => tool.function.name)).toContain("read");
    expect(requests[0].tools.map((tool: any) => tool.function.name)).not.toContain("write");
    expect(JSON.stringify(requests[0].messages)).toContain("pdf");
    expect(await fs.readdir(path.join(root, "workspace/.localapp-public-skills"))).toEqual(["pdf"]);
    const ctx = (harness as any).ctx;
    const agent = (harness as any).conversations.get("selected-skills").handle.agent;
    const result = await agent.ctx.tools.execute({ callId: "disabled-write", signal: new AbortController().signal, name: "write", arguments: { file_path: "blocked.txt", content: "blocked" }, agent });
    expect(result.isError).toBe(true);
    expect(await fs.stat(path.join(root, "workspace/blocked.txt")).catch(() => undefined)).toBeUndefined();
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

it("checks the real Agent execution environment without calling a model", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root, capabilities: ["files", "terminal", "skills"], skills: ["pdf"] });
  const model = vi.fn(); vi.stubGlobal("fetch", model);
  try {
    await harness.initialize();
    const report = await harness.checkEnvironment();
    expect(report.checks.find(c => c.id === "terminal")?.status).toBe("ready");
    expect(report.checks.some(c => c.id === "runner")).toBe(true);
    expect(report.checks.some(c => c.id === "pdfplumber")).toBe(true);
    expect(model).not.toHaveBeenCalled();
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);

it("shares the configured runtime read-only while keeping other Server data private", async () => {
  const { DeepSeekHarness } = await import("../deepseek-harness.mjs");
  const fsSync = await import("node:fs");
  const dataDir = path.join(root, "python-server-data");
  const directory = path.join(dataDir, "python-environments", "test");
  const executable = path.join(directory, "bin", "python");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  // A real executable under the selected environment tests PATH and OS file rules.
  await fs.symlink(process.execPath, executable);
  await fs.writeFile(path.join(directory, "library.txt"), "shared-library");
  const outside = path.join(dataDir, "other-application.txt");
  await fs.writeFile(outside, "private-other-application");
  const harness = new DeepSeekHarness({ llmApiKey: "test", llmBaseUrl: "http://model.test/v1", llmModel: "test", root: path.join(dataDir, "agent", "demo"), capabilities: ["files", "terminal"], pythonEnvironment: { executable, directory, baseDirectory: path.dirname(path.dirname(fsSync.realpathSync(process.execPath))), version: "test", revision: "test", managed: true } });
  try {
    await harness.initialize();
    const ctx = (harness as any).ctx;
    const code = `const fs=require('fs');const result={library:fs.readFileSync(${JSON.stringify(path.join(directory, "library.txt"))},'utf8'),virtual:process.env.VIRTUAL_ENV};for(const [key,file] of [['write',${JSON.stringify(path.join(directory,"write.txt"))}],['read',${JSON.stringify(outside)}]]){try{key==='write'?fs.writeFileSync(file,'bad'):fs.readFileSync(file);result[key]='allowed'}catch{result[key]='denied'}}console.log(JSON.stringify(result));`;
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
    const output = await (await ctx.shell.execute(ctx.shell.resolve({ command: `python -e ${quote(code)}`, workdir: path.join(dataDir, "agent/demo/workspace"), timeoutMs: 15_000 }))).result();
    expect(JSON.parse(output.stdout.text)).toEqual({ library: "shared-library", virtual: directory, write: "denied", read: "denied" });
  } finally { await harness.close(); await fs.rm(root, { recursive: true, force: true }); }
}, 30_000);
