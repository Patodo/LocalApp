import type { EventEmitter } from "node:events";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AgentKind } from "../lib/agents/types.js";
import type { AgentRunner } from "../lib/agent-runner.js";
import type { TaskEvent, TaskRunner } from "../lib/task-runner.js";
import type { TaskStore } from "../lib/task-store.js";

export async function tasksRoutes(
  app: FastifyInstance,
  services: { taskStore: TaskStore; taskRunner: TaskRunner; agentRunner: AgentRunner },
): Promise<void> {
  const { taskStore, taskRunner, agentRunner } = services;

  app.get("/api/tasks", async (request) => ({ success: true, data: taskStore.list(request.userId) }));
  app.get("/api/tasks/capabilities", async () => ({ success: true, data: { agents: agentRunner.capabilities() } }));

  app.post("/api/tasks", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const task = await taskRunner.start({
        workspaceId: requiredString(body?.workspaceId, "workspaceId"),
        kind: requiredKind(body?.kind),
        executable: requiredString(body?.executable, "executable"),
        args: requiredStringArray(body?.args),
        timeoutMs: requiredInteger(body?.timeoutMs, "timeoutMs"),
        requestedBy: request.userId,
      });
      return reply.status(201).send({ success: true, data: task });
    } catch (error) {
      return taskError(reply, error);
    }
  });

  app.post("/api/tasks/agents", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      const task = await agentRunner.start({
        workspaceId: requiredString(body?.workspaceId, "workspaceId"),
        agent: requiredAgent(body?.agent),
        prompt: requiredString(body?.prompt, "prompt"),
        timeoutMs: requiredInteger(body?.timeoutMs, "timeoutMs"),
        requestedBy: request.userId,
      });
      return reply.status(201).send({ success: true, data: task });
    } catch (error) {
      return taskError(reply, error);
    }
  });

  app.get("/api/tasks/:id", async (request, reply) => {
    const task = taskStore.getOwned((request.params as { id: string }).id, request.userId);
    if (!task) return reply.status(404).send({ success: false, error: "Task not found" });
    return { success: true, data: task };
  });

  app.post("/api/tasks/:id/cancel", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      if (!taskStore.getOwned(id, request.userId)) return reply.status(404).send({ success: false, error: "Task not found" });
      return { success: true, data: await taskRunner.cancel(id) };
    } catch (error) {
      return taskError(reply, error);
    }
  });

  app.get("/api/tasks/:id/logs", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      if (!taskStore.getOwned(id, request.userId)) return reply.status(404).send({ success: false, error: "Task not found" });
      const cursorValue = (request.query as { cursor?: unknown }).cursor;
      const cursor = cursorValue === undefined ? 0 : Number(cursorValue);
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid log cursor");
      return { success: true, data: taskRunner.logs(id, cursor) };
    } catch (error) {
      return taskError(reply, error);
    }
  });

  app.get("/api/tasks/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const task = taskStore.getOwned(id, request.userId);
    if (!task) return reply.status(404).send({ success: false, error: "Task not found" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (event: TaskEvent) => reply.raw.write(`event: task\ndata: ${JSON.stringify(event.task)}\n\n`);
    const initial: TaskEvent = { taskId: id, status: task.status, task };
    write(initial);
    if (task.status !== "running") {
      reply.raw.end();
      return;
    }
    const emitter: EventEmitter = taskRunner.events(id);
    const listener = (event: TaskEvent) => {
      write(event);
      if (event.status !== "running") {
        emitter.off("event", listener);
        reply.raw.end();
      }
    };
    emitter.on("event", listener);
    request.raw.once("close", () => emitter.off("event", listener));
  });

  app.post("/api/tasks/:id/messages", async (request, reply) => {
    try {
      const id = (request.params as { id: string }).id;
      const task = taskStore.getOwned(id, request.userId);
      if (!task || task.kind !== "agent" || !isAgent(task.executable)) {
        return reply.status(404).send({ success: false, error: "Agent task not found" });
      }
      const body = request.body as { prompt?: unknown } | null;
      await agentRunner.send(id, requiredString(body?.prompt, "prompt"), task.executable);
      return reply.status(202).send({ success: true });
    } catch (error) {
      return taskError(reply, error);
    }
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value;
}

function requiredStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error("args must be an array of strings");
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${field} must be an integer`);
  return value as number;
}

function requiredKind(value: unknown): "build" | "test" | "git" | "agent" {
  if (value !== "build" && value !== "test" && value !== "git" && value !== "agent") throw new Error("Invalid task kind");
  return value;
}

function requiredAgent(value: unknown): AgentKind {
  if (!isAgent(value)) throw new Error("Invalid agent");
  return value;
}

function isAgent(value: unknown): value is AgentKind {
  return value === "codex" || value === "opencode";
}

function taskError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "WORKSPACE_NOT_FOUND" || message === "TASK_NOT_FOUND") {
    return reply.status(404).send({ success: false, error: "Task not found" });
  }
  return reply.status(400).send({ success: false, error: message });
}
