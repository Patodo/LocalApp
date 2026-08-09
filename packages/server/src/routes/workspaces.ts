import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { WorkspaceStore } from "../lib/workspace-store.js";
import { getUserRole } from "../lib/meta-sqlite.js";

export async function workspacesRoutes(app: FastifyInstance, workspaceStore: WorkspaceStore): Promise<void> {
  app.get("/api/workspaces", async (request) => ({ success: true, data: workspaceStore.list(request.userId) }));

  app.post("/api/workspaces", async (request, reply) => {
    try {
      const body = request.body as { name?: unknown } | null;
      const workspace = await workspaceStore.create({ name: requireString(body?.name, "name"), ownerId: request.userId });
      return reply.status(201).send({ success: true, data: workspace });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.post("/api/workspaces/clone", async (request, reply) => {
    if (!requireExecutionAdmin(request.userId, reply)) return;
    const abort = new AbortController();
    let complete = false;
    const cancel = () => { if (!complete) abort.abort(); };
    request.raw.once("aborted", cancel);
    reply.raw.once("close", cancel);
    try {
      const body = request.body as { name?: unknown; repositoryUrl?: unknown } | null;
      const workspace = await workspaceStore.clone({
        name: requireString(body?.name, "name"),
        repositoryUrl: requireString(body?.repositoryUrl, "repositoryUrl"),
        ownerId: request.userId,
        signal: abort.signal,
      });
      complete = true;
      return reply.status(201).send({ success: true, data: workspace });
    } catch (error) {
      return workspaceError(reply, error);
    } finally {
      request.raw.off("aborted", cancel);
      reply.raw.off("close", cancel);
    }
  });

  app.post("/api/workspaces/import", async (request, reply) => {
    const uploadDirectory = path.join(workspaceStore.workspaceDir, ".uploads");
    fs.mkdirSync(uploadDirectory, { recursive: true });
    const archivePath = path.join(uploadDirectory, `${randomUUID()}.zip`);
    try {
      const query = request.query as { name?: unknown };
      let multipartName: unknown;
      let archiveReceived = false;
      const parts = request.parts({
        limits: { files: 1, fileSize: workspaceStore.archiveLimits.maxCompressedBytes },
      });
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "name") multipartName = part.value;
          continue;
        }
        if (archiveReceived) throw new Error("Only one workspace archive is allowed");
        archiveReceived = true;
        let compressedBytes = 0;
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            compressedBytes += chunk.length;
            if (compressedBytes > workspaceStore.archiveLimits.maxCompressedBytes) callback(new Error("Workspace archive limit exceeded: compressed size"));
            else callback(null, chunk);
          },
        });
        await pipeline(part.file, limiter, fs.createWriteStream(archivePath, { flags: "wx", mode: 0o600 }));
        if (part.file.truncated) throw new Error("Workspace archive limit exceeded: compressed size");
      }
      if (!archiveReceived) throw new Error("Workspace archive is required");
      const name = requireString(query.name ?? multipartName, "name");
      const workspace = await workspaceStore.importArchive({ name, ownerId: request.userId, archivePath });
      return reply.status(201).send({ success: true, data: workspace });
    } catch (error) {
      return workspaceError(reply, error);
    } finally {
      fs.rmSync(archivePath, { force: true });
    }
  });

  app.get("/api/workspaces/:id/file", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const query = request.query as { path?: unknown };
      const relativePath = requireString(query.path, "path");
      const content = await workspaceStore.readFile(id, request.userId, relativePath);
      return { success: true, data: { path: relativePath, content } };
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.put("/api/workspaces/:id/file", async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { path?: unknown; content?: unknown } | null;
      await workspaceStore.writeFile(
        id,
        request.userId,
        requireString(body?.path, "path"),
        requireString(body?.content, "content", true),
      );
      return reply.status(204).send();
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.delete("/api/workspaces/:id", async (request, reply) => {
    try {
      const removed = await workspaceStore.remove((request.params as { id: string }).id, request.userId);
      if (!removed) return reply.status(404).send({ success: false, error: "Workspace not found" });
      return reply.status(204).send();
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.post("/api/workspaces/:id/build", async (request, reply) => {
    if (!requireExecutionAdmin(request.userId, reply)) return;
    try {
      const task = await workspaceStore.build((request.params as { id: string }).id, request.userId);
      return reply.status(201).send({ success: true, data: task });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });

  app.post("/api/workspaces/:id/install", async (request, reply) => {
    if (!requireExecutionAdmin(request.userId, reply)) return;
    try {
      const task = await workspaceStore.install((request.params as { id: string }).id, request.userId);
      return reply.status(201).send({ success: true, data: task });
    } catch (error) {
      return workspaceError(reply, error);
    }
  });
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${field} is required`);
  return value;
}

function workspaceError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "WORKSPACE_NOT_FOUND" || message === "WORKSPACE_FILE_NOT_FOUND") {
    return reply.status(404).send({ success: false, error: "Workspace not found" });
  }
  if (message === "ADMIN_EXECUTION_REQUIRED") return reply.status(403).send({ success: false, error: "Administrator execution required" });
  const status = /already exists/i.test(message) ? 409 : 400;
  return reply.status(status).send({ success: false, error: message });
}

function requireExecutionAdmin(userId: string, reply: FastifyReply): boolean {
  if (getUserRole(userId) === "admin") return true;
  reply.status(403).send({ success: false, error: "Administrator execution required" });
  return false;
}
