import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMetaDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import type { AgentRunner } from "../src/lib/agent-runner.js";
import type { TaskEvent, TaskRunner } from "../src/lib/task-runner.js";
import { TaskStore } from "../src/lib/task-store.js";
import { tasksRoutes } from "../src/routes/tasks.js";

let root: string | undefined;

afterEach(() => {
  closeMetaDb();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("task SSE", () => {
  it("rechecks after subscribing so a terminal transition is not lost and removes its listener", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-task-events-"));
    await initMetaDb(root);
    const store = new TaskStore();
    const task = store.create({
      workspaceId: "00000000-0000-0000-0000-000000000001",
      kind: "test",
      executable: "node",
      args: [],
      timeoutMs: 1_000,
      requestedBy: "owner",
      outputPath: path.join(root, "task.log"),
      status: "running",
    });
    const emitter = new EventEmitter();
    const fakeRunner = {
      events(id: string) {
        const finished = store.finish(id, "succeeded", { exitCode: 0 });
        const fallback = setTimeout(() => {
          emitter.emit("event", { type: "status", taskId: id, status: "succeeded", task: finished } satisfies TaskEvent);
        }, 500);
        fallback.unref();
        return emitter;
      },
    } as unknown as TaskRunner;
    const app = Fastify();
    app.addHook("onRequest", async (request) => { request.userId = "owner"; });
    await tasksRoutes(app, {
      taskStore: store,
      taskRunner: fakeRunner,
      agentRunner: {} as AgentRunner,
    });

    const startedAt = Date.now();
    const response = await app.inject({ method: "GET", url: `/api/tasks/${task.id}/events` });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(250);
    expect(response.body).toContain('"status":"succeeded"');
    expect(emitter.listenerCount("event")).toBe(0);
    await app.close();
  });
});
