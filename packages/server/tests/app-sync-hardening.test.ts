import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { AppSyncSource, SyncSourceError } from "../src/lib/app-sync-source.js";
import { AppSyncTarget } from "../src/lib/app-sync-target.js";
import { installAppPackage, type InstallOutcome } from "../src/lib/app-installer.js";
import { writeAppPackage } from "../src/lib/app-package.js";
import { closeMetaDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import type { PeerStore } from "../src/lib/peer-store.js";
import { SyncJobStore, type SyncJobStatus } from "../src/lib/sync-job-store.js";
import { SyncSessionStore } from "../src/lib/sync-session-store.js";

describe("peer synchronization concurrency, deadlines, and cancellation", () => {
  const roots: string[] = [];
  const sources: AppSyncSource[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const source of sources.splice(0)) await source.shutdown();
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
    closeMetaDb();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("serializes concurrent target commits and returns the same persisted outcome to a response-loss retry", async () => {
    const dataDir = tempRoot();
    const packagePath = await packageFixture(dataDir);
    const bytes = fs.readFileSync(packagePath);
    const digest = (await import("../src/lib/app-package.js")).inspectAppPackage(packagePath).then((value) => value.digest);
    const sessions = new SyncSessionStore({ dataDir });
    const id = crypto.randomUUID();
    sessions.create({
      id, ownerId: "owner", mode: "app-only", appName: "sync-app", appVersion: "1.0.0",
      packageDigest: await digest, packageSize: bytes.length,
    });
    await sessions.receivePackage({ id, ownerId: "owner", stream: Readable.from(bytes), contentLength: bytes.length });
    let installCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const outcome: InstallOutcome = {
      name: "sync-app", ownerId: "owner", localVersion: 1, appVersion: "1.0.0",
      digest: await digest, created: true, upgraded: false, idempotent: false,
    };
    const target = new AppSyncTarget(dataDir, sessions, {
      install: async () => { installCalls += 1; await gate; return outcome; },
    });

    const first = target.commit(id, "owner");
    const second = target.commit(id, "owner");
    try {
      await waitFor(() => installCalls === 1 && sessions.getOwned(id, "owner")?.status === "committing", 500);
      expect(installCalls).toBe(1);
      expect(sessions.getOwned(id, "owner")?.status).toBe("committing");
      release();
      expect(await first).toEqual(await second);
      expect((await target.commit(id, "owner")).outcome).toEqual(outcome);
      expect(installCalls).toBe(1);
    } finally {
      release();
      await Promise.allSettled([first, second]);
    }
  });

  it("fails a never-resolving upload within its hard deadline and leaves no live run", async () => {
    const harness = await sourceHarness((request, response) => {
      if (request.method === "POST" && request.url === "/api/peer/sync-sessions") return json(response, 201, {});
      if (request.method === "PUT") { request.resume(); return; }
      response.writeHead(404).end();
    }, { uploadTimeoutMs: 40, commitTimeoutMs: 100 });
    const job = await harness.source.start(harness.input);
    const terminal = await waitForStatus(harness.jobs, job.id, new Set(["failed", "recovery-required"]), 500);
    expect(terminal.status).toBe("failed");
    await expect(Promise.race([
      harness.source.shutdown().then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ])).resolves.toBe("done");
  });

  it("retries commit after response loss and polls the persisted target outcome", async () => {
    let commitCalls = 0;
    const harness = await sourceHarness((request, response) => {
      if (request.method === "POST" && request.url === "/api/peer/sync-sessions") return json(response, 201, {});
      if (request.method === "PUT") { request.resume(); request.on("end", () => json(response, 200, {})); return; }
      if (request.method === "POST" && request.url?.endsWith("/commit")) {
        commitCalls += 1;
        if (commitCalls === 1) { request.socket.destroy(); return; }
        return json(response, 200, { success: true, data: { session: { status: "completed" } } });
      }
      response.writeHead(404).end();
    }, { uploadTimeoutMs: 200, commitTimeoutMs: 800, commitRetryDelayMs: 10 });
    const job = await harness.source.start(harness.input);
    expect((await waitForStatus(harness.jobs, job.id, new Set(["completed", "failed", "recovery-required"]), 1_500)).status).toBe("completed");
    expect(commitCalls).toBe(2);
  });

  it("bounds a never-resolving commit and persists an unknown target outcome as recovery-required", async () => {
    const harness = await sourceHarness((request, response) => {
      if (request.method === "POST" && request.url === "/api/peer/sync-sessions") return json(response, 201, {});
      if (request.method === "PUT") { request.resume(); request.on("end", () => json(response, 200, {})); return; }
      if (request.method === "POST" && request.url?.endsWith("/commit")) return;
      response.writeHead(404).end();
    }, { uploadTimeoutMs: 200, commitTimeoutMs: 40, commitRetryDelayMs: 5 });
    const job = await harness.source.start(harness.input);
    const terminal = await waitForStatus(harness.jobs, job.id, new Set(["recovery-required"]), 500);
    expect(terminal.error).toContain("outcome could not be verified");
    await expect(Promise.race([
      harness.source.shutdown().then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 200)),
    ])).resolves.toBe("done");
  });

  it("lets the target arbitrate cancellation at the activating boundary", async () => {
    let deleteCalls = 0;
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
    const harness = await sourceHarness((request, response) => {
      if (request.method === "POST" && request.url === "/api/peer/sync-sessions") return json(response, 201, {});
      if (request.method === "PUT") { request.resume(); request.on("end", () => json(response, 200, {})); return; }
      if (request.method === "POST" && request.url?.endsWith("/commit")) {
        void commitGate.then(() => json(response, 200, {})); return;
      }
      if (request.method === "DELETE") { deleteCalls += 1; return json(response, 409, { code: "SYNC_CANNOT_CANCEL" }); }
      response.writeHead(404).end();
    }, { uploadTimeoutMs: 200, commitTimeoutMs: 800, commitRetryDelayMs: 10 });
    const job = await harness.source.start(harness.input);
    await waitForStatus(harness.jobs, job.id, new Set(["activating"]), 500);
    await expect(harness.source.cancel(job.id, "owner")).rejects.toMatchObject<Partial<SyncSourceError>>({
      statusCode: 409, code: "SYNC_CANNOT_CANCEL",
    });
    expect(deleteCalls).toBe(1);
    releaseCommit();
    expect((await waitForStatus(harness.jobs, job.id, new Set(["completed"]), 500)).status).toBe("completed");
  });

  it("cancels locally only after the target confirms commit has not begun", async () => {
    let deleteCalls = 0;
    const harness = await sourceHarness((request, response) => {
      if (request.method === "POST" && request.url === "/api/peer/sync-sessions") return json(response, 201, {});
      if (request.method === "PUT") { request.resume(); request.on("end", () => json(response, 200, {})); return; }
      if (request.method === "POST" && request.url?.endsWith("/commit")) return;
      if (request.method === "DELETE") { deleteCalls += 1; response.writeHead(204).end(); return; }
      response.writeHead(404).end();
    }, { uploadTimeoutMs: 200, commitTimeoutMs: 800, commitRetryDelayMs: 10 });
    const job = await harness.source.start(harness.input);
    await waitForStatus(harness.jobs, job.id, new Set(["activating"]), 500);
    const cancelled = await harness.source.cancel(job.id, "owner");
    expect(cancelled).toMatchObject({ status: "failed", error: "Cancelled" });
    expect(deleteCalls).toBe(1);
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-sync-hardening-"));
    roots.push(root);
    return root;
  }

  async function sourceHarness(
    handler: http.RequestListener,
    options: { uploadTimeoutMs: number; commitTimeoutMs: number; commitRetryDelayMs?: number },
  ) {
    const dataDir = tempRoot();
    await initMetaDb(dataDir);
    const packagePath = await packageFixture(dataDir);
    await installAppPackage({ dataDir, ownerId: "owner", packagePath });
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const peers = { loadForCheck: () => ({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "secret" }) } as PeerStore;
    const jobs = new SyncJobStore();
    const source = new AppSyncSource(dataDir, jobs, peers, options);
    sources.push(source);
    return { source, jobs, input: { ownerId: "owner", appName: "sync-app", peerId: "peer", withData: false as const } };
  }
});

async function packageFixture(dataDir: string): Promise<string> {
  const outputPath = path.join(dataDir, `${crypto.randomUUID()}.localapp`);
  await writeAppPackage({
    outputPath,
    metadata: { schemaVersion: 1, appId: "sync-app", version: "1.0.0", platformVersion: "^1.0" },
    files: [
      { path: "manifest.json", content: Buffer.from(JSON.stringify({ name: "sync-app", platformVersion: "^1.0" })) },
      { path: "dist/index.html", content: Buffer.from("sync") },
    ],
  });
  return outputPath;
}

function json(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function waitForStatus(
  jobs: SyncJobStore,
  id: string,
  statuses: Set<SyncJobStatus>,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.get(id)!;
    if (statuses.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${[...statuses].join(", ")}; current=${jobs.get(id)?.status}`);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}
