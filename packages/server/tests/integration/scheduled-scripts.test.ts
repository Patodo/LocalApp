import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server.js";
import { closeMetaDb, provisionUserWithApiKey } from "../../src/lib/meta-sqlite.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";

const adminPassword = randomUUID();
const endpoint = "/api/system/scheduled-scripts";
const admin = { "x-api-key": randomUUID() };
const delegate = { "x-api-key": randomUUID() };
const outsider = { "x-api-key": randomUUID() };
const manual = { "x-localapp-script-token": randomUUID() };
const parent = path.resolve(__dirname, "../../../../tmp/scheduled-scripts");
const schedule = { timeZone: "Asia/Taipei", from: "07:00", until: "23:00", intervalMinutes: 30 };
let root: string;
let app: Awaited<ReturnType<typeof buildServer>> | undefined;
let groupId: string;

async function start(timeoutSeconds = 10, descendant = false) {
  await fs.mkdir(parent, { recursive: true });
  root = await fs.mkdtemp(path.join(parent, "run-"));
  const filename = path.join(root, "scripts.json");
  const program = path.join(root, "scan.cjs");
  await fs.writeFile(program, [
    "const fs = require('node:fs');",
    "fs.appendFileSync('runs.txt', process.argv[2] + '\\n');",
    "if (process.env.SCHEDULED_SCRIPTS_TEST_SECRET) process.exit(7);",
    "if (process.env.SCHEDULED_SCRIPTS_TEST_INPUT !== 'allowed') process.exit(8);",
    "if (process.env.SCHEDULED_SCRIPTS_TEST_MANUAL_TOKEN) process.exit(9);",
    descendant ? `
      const code = "setTimeout(() => require('node:fs').writeFileSync('orphan', ''), 2400)";
      require('node:child_process').spawn(process.execPath, ['-e', code], { stdio: 'ignore' });
    ` : "",
    "const timer = setInterval(() => {",
    "  if (fs.existsSync('complete')) clearInterval(timer);",
    "}, 40);",
  ].join("\n"));
  const tokens = new SetupTokenStore();
  const env = {
    DATA_DIR: root, BOOTSTRAP_API_KEY: admin["x-api-key"],
    SCHEDULED_SCRIPTS_TEST_INPUT: "allowed", SCHEDULED_SCRIPTS_TEST_SECRET: randomUUID(),
    SCHEDULED_SCRIPTS_TEST_MANUAL_TOKEN: manual["x-localapp-script-token"],
  };
  const options = { pluginCombination: "platform" as const, setupTokens: tokens };
  const server = await buildServer({ ...options, env });
  app = server;
  expect((await server.inject({ url: endpoint, headers: admin })).statusCode).toBe(404);
  const setup = await server.inject({
    method: "POST", url: "/api/setup/initialize",
    payload: { token: tokens.issue().token, username: "scheduler-admin", password: adminPassword },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  provisionUserWithApiKey("operator", "Operator", "unused", delegate["x-api-key"]);
  provisionUserWithApiKey("outsider", "Outsider", "unused", outsider["x-api-key"]);
  const group = await server.inject({
    method: "POST", url: "/api/groups", headers: admin, payload: { name: "Script Operators" },
  });
  expect(group.statusCode, group.body).toBe(201);
  groupId = group.json().data.id;
  const members = await server.inject({
    method: "POST", url: `/api/groups/${groupId}/members`, headers: admin, payload: { userIds: ["operator"] },
  });
  expect(members.statusCode, members.body).toBe(200);
  await server.close();
  app = undefined;
  closeMetaDb();
  const command = { executable: process.execPath, cwd: root, schedule, timeoutSeconds, envFrom: ["SCHEDULED_SCRIPTS_TEST_INPUT"] };
  await fs.writeFile(filename, JSON.stringify([
    { id: "scan", ...command, args: [program, "expected"], groupId, manualRunTokenEnv: "SCHEDULED_SCRIPTS_TEST_MANUAL_TOKEN" },
    { id: "private", ...command, args: [program, "private"] },
  ]));
  app = await buildServer({ ...options, env: { ...env, LOCALAPP_SCHEDULED_SCRIPTS_FILE: filename } });
  return app;
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await app?.close();
  app = undefined;
  closeMetaDb();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("scheduled server scripts", () => {
  it("exposes only granted jobs and runs the configured executable with fixed inputs", async () => {
    const server = await start();
    const list = (headers?: Record<string, string>) => server.inject({ url: endpoint, headers });
    const run = (headers?: Record<string, string>, id = "scan", payload?: object) =>
      server.inject({ method: "POST", url: `${endpoint}/${id}/run`, headers: { ...manual, ...headers }, payload });
    expect((await list()).statusCode).toBe(401);
    expect((await run()).statusCode).toBe(401);
    expect((await run({ "x-api-key": "wrong" })).statusCode).toBe(401);
    const login = await server.inject({
      method: "POST", url: "/api/auth/login", payload: { username: "scheduler-admin", password: adminPassword },
    });
    expect(login.statusCode, login.body).toBe(200);
    const cookie = login.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
    expect(cookie).toContain("token=");
    expect((await run({ cookie })).statusCode).toBe(401);
    const minted = await server.inject({ method: "POST", url: "/api/keys", headers: { cookie } });
    expect(minted.json().success, minted.body).toBe(true);
    const browserKey = { "x-api-key": minted.json().data.key };
    expect((await list(browserKey)).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: `${endpoint}/scan/run`, headers: browserKey })).statusCode).toBe(403);
    expect((await list(outsider)).json().data).toEqual([]);
    expect((await run(outsider)).statusCode).toBe(404);
    expect((await run(delegate, "private")).statusCode).toBe(404);
    expect((await run(admin, "private")).statusCode).toBe(403);
    expect((await run({ ...delegate, "x-localapp-script-token": "wrong" })).statusCode).toBe(403);
    expect((await server.inject({ method: "POST", url: `${endpoint}/scan/run`, headers: delegate })).statusCode).toBe(403);
    expect((await list(admin)).json().data.map((item: { id: string }) => item.id)).toEqual(["scan", "private"]);
    expect((await list(delegate)).json().data).toEqual([
      { id: "scan", schedule, manualRunEnabled: true, running: false, lastRun: null },
    ]);
    expect((await run(delegate, "scan", { args: ["injected"] })).statusCode).toBe(400);
    expect((await server.inject({
      method: "POST", url: `${endpoint}/scan/run?args=injected`, headers: { ...delegate, ...manual },
    })).statusCode).toBe(400);
    expect((await run(delegate)).statusCode).toBe(202);
    expect((await run(delegate)).statusCode).toBe(409);
    await fs.writeFile(path.join(root, "complete"), "");
    await expect.poll(async () => (await list(delegate)).json().data[0].lastRun?.status).toBe("succeeded");
    expect(await fs.readFile(path.join(root, "runs.txt"), "utf8")).toBe("expected\n");
    const revoke = await server.inject({
      method: "POST", url: `/api/groups/${groupId}/members/remove`, headers: admin, payload: { userIds: ["operator"] },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect((await run(delegate)).statusCode).toBe(404);
    expect((await list(delegate)).json().data).toEqual([]);
  });

  it("runs at the opening boundary and skips 23:00 without requesting a model", async () => {
    const server = await start();
    await fs.writeFile(path.join(root, "complete"), "");
    const requestModel = vi.fn(() => { throw new Error("Unexpected model request"); });
    vi.stubGlobal("fetch", requestModel);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-15T14:59:59Z"));
    await server.listen({ host: "127.0.0.1", port: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    const statuses = async () => (await server.inject({ url: endpoint, headers: admin })).json().data;
    expect((await statuses()).every((item: { lastRun: unknown }) => item.lastRun === null)).toBe(true);
    vi.setSystemTime(new Date("2026-09-15T22:59:00Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    await expect.poll(async () => (await statuses())[0].lastRun?.status).toBe("succeeded");
    expect((await statuses())[0].lastRun).toMatchObject({
      trigger: "schedule", startedAt: "2026-09-15T23:00:00.000Z",
    });
    expect(requestModel).not.toHaveBeenCalled();
  });

  it("terminates the timed-out process tree before accepting another run", async () => {
    const server = await start(1, true);
    const run = () => server.inject({ method: "POST", url: `${endpoint}/scan/run`, headers: { ...delegate, ...manual } });
    expect((await run()).statusCode).toBe(202);
    await expect.poll(async () => (await server.inject({ url: endpoint, headers: delegate })).json().data[0].lastRun?.status, {
      timeout: 5000,
    }).toBe("timed_out");
    await new Promise(resolve => setTimeout(resolve, 2_000));
    await expect(fs.access(path.join(root, "orphan"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await run()).statusCode).toBe(202);
  });
});
