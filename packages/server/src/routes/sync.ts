import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";
import { AppInstallError } from "../lib/app-installer.js";
import { AppDataError } from "../lib/app-data-errors.js";
import { AppSyncSource, SyncSourceError } from "../lib/app-sync-source.js";
import { AppSyncTarget, targetInstallCode, targetInstallStatus } from "../lib/app-sync-target.js";
import { SyncSessionError } from "../lib/sync-session-store.js";
import { validateApiKey } from "../lib/meta-sqlite.js";
import { validateName } from "../lib/validate-name.js";

const TERMINAL = new Set(["completed", "rolled-back", "failed", "recovery-required"]);

export async function syncTargetRoutes(app: FastifyInstance, target: AppSyncTarget): Promise<void> {
  app.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));

  app.post("/api/peer/sync-sessions", async (request, reply) => {
    const ownerId = bearerOwner(request, reply);
    if (!ownerId) return;
    try {
      const body = request.body as Record<string, unknown> | null;
      const appName = requiredString(body?.appName, "appName");
      const nameError = validateName(appName);
      if (nameError) throw new SyncSessionError("APP_NAME_INVALID", nameError, 400);
      const mode = body?.mode === "app-only" || body?.mode === "app-and-data" ? body.mode : invalidMode();
      const session = target.create({
        id: requiredString(body?.id, "id"), ownerId,
        mode,
        appName, appVersion: requiredString(body?.appVersion, "appVersion"),
        packageDigest: requiredString(body?.packageDigest, "packageDigest"),
        packageSize: requiredInteger(body?.packageSize, "packageSize"),
        ...(mode === "app-and-data" ? {
          dataDigest: requiredString(body?.dataDigest, "dataDigest"),
          dataSize: requiredInteger(body?.dataSize, "dataSize"),
        } : {}),
      });
      return reply.status(session.status === "created" ? 201 : 200).send({ success: true, data: publicSession(session) });
    } catch (error) { return targetError(reply, error); }
  });

  app.put<{ Params: { id: string } }>("/api/peer/sync-sessions/:id/data", async (request, reply) => {
    const ownerId = bearerOwner(request, reply);
    if (!ownerId) return;
    try {
      const length = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length < 0) throw new SyncSessionError("SYNC_CONTENT_LENGTH_REQUIRED", "A valid Content-Length is required", 411);
      const session = await target.sessions.receiveData({
        id: request.params.id, ownerId, stream: request.body as Readable, contentLength: length,
      });
      return { success: true, data: publicSession(session) };
    } catch (error) { return targetError(reply, error); }
  });

  app.put<{ Params: { id: string } }>("/api/peer/sync-sessions/:id/package", async (request, reply) => {
    const ownerId = bearerOwner(request, reply);
    if (!ownerId) return;
    try {
      const length = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length < 0) throw new SyncSessionError("SYNC_CONTENT_LENGTH_REQUIRED", "A valid Content-Length is required", 411);
      const session = await target.sessions.receivePackage({
        id: request.params.id, ownerId, stream: request.body as Readable, contentLength: length,
      });
      return { success: true, data: publicSession(session) };
    } catch (error) { return targetError(reply, error); }
  });

  app.post<{ Params: { id: string } }>("/api/peer/sync-sessions/:id/commit", async (request, reply) => {
    const ownerId = bearerOwner(request, reply);
    if (!ownerId) return;
    try {
      const result = await target.commit(request.params.id, ownerId);
      return { success: true, data: { session: publicSession(result.session), outcome: result.outcome } };
    } catch (error) { return targetError(reply, error); }
  });

  app.delete<{ Params: { id: string } }>("/api/peer/sync-sessions/:id", async (request, reply) => {
    const ownerId = bearerOwner(request, reply);
    if (!ownerId) return;
    try {
      if (!target.sessions.remove(request.params.id, ownerId)) return reply.status(404).send({ success: false, error: "Synchronization session not found" });
      return reply.status(204).send();
    } catch (error) { return targetError(reply, error); }
  });
}

export async function syncSourceRoutes(app: FastifyInstance, source: AppSyncSource): Promise<void> {
  app.get("/api/sync-jobs", async (request) => ({ success: true, data: source.jobs.list(request.userId) }));

  app.post<{ Params: { name: string } }>("/api/me/apps/:name/sync", async (request, reply) => {
    try {
      const nameError = validateName(request.params.name);
      if (nameError) throw new SyncSourceError(400, nameError, "APP_NAME_INVALID");
      const body = request.body as Record<string, unknown> | null;
      const peerId = requiredString(body?.peerId, "peerId");
      let job;
      if (body?.withData === true) {
        const confirmation = requiredString(body.confirmation, "confirmation");
        if (confirmation !== request.params.name) throw new SyncSourceError(400, "Application name confirmation does not match", "APP_CONFIRMATION_MISMATCH");
        job = await source.start({ ownerId: request.userId, appName: request.params.name, peerId, withData: true, confirmation });
      } else if (body?.withData === false) {
        job = await source.start({ ownerId: request.userId, appName: request.params.name, peerId, withData: false });
      } else {
        throw new SyncSourceError(400, "withData must be a boolean", "SYNC_MODE_UNSUPPORTED");
      }
      return reply.status(202).send({ success: true, data: job });
    } catch (error) { return sourceError(reply, error); }
  });

  app.get<{ Params: { id: string } }>("/api/sync-jobs/:id", async (request, reply) => {
    const job = source.jobs.getOwned(request.params.id, request.userId);
    return job ? { success: true, data: job } : reply.status(404).send({ success: false, error: "Synchronization job not found" });
  });

  app.post<{ Params: { id: string } }>("/api/sync-jobs/:id/cancel", async (request, reply) => {
    try { return { success: true, data: await source.cancel(request.params.id, request.userId) }; }
    catch (error) { return sourceError(reply, error); }
  });

  app.get<{ Params: { id: string } }>("/api/sync-jobs/:id/events", async (request, reply) => {
    const initial = source.jobs.getOwned(request.params.id, request.userId);
    if (!initial) return reply.status(404).send({ success: false, error: "Synchronization job not found" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no",
    });
    let ended = false;
    const emitter = source.events(initial.id);
    const finish = () => { if (!ended) { ended = true; reply.raw.end(); } };
    const write = (job: typeof initial) => { if (!ended) reply.raw.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`); };
    if (TERMINAL.has(initial.status)) { write(initial); finish(); return; }
    const listener = (job: typeof initial) => { write(job); if (TERMINAL.has(job.status)) { emitter.off("status", listener); finish(); } };
    emitter.on("status", listener);
    const current = source.jobs.getOwned(initial.id, request.userId);
    if (!current) { emitter.off("status", listener); finish(); return; }
    write(current);
    if (TERMINAL.has(current.status)) { emitter.off("status", listener); finish(); return; }
    request.raw.once("close", () => { emitter.off("status", listener); finish(); });
  });
}

function bearerOwner(request: FastifyRequest, reply: FastifyReply): string | null {
  const authorization = request.headers.authorization;
  const match = typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  const ownerId = match ? validateApiKey(match[1]) : null;
  if (!ownerId) reply.status(401).send({ success: false, error: "Authentication required" });
  else request.userId = ownerId;
  return ownerId;
}

function publicSession(session: { id: string; mode: string; appName: string; appVersion: string; packageDigest: string; packageSize: number; dataDigest: string | null; dataSize: number | null; status: string; outcome: unknown; error: string | null; createdAt: string; updatedAt: string }) {
  return { id: session.id, mode: session.mode, appName: session.appName, appVersion: session.appVersion, packageDigest: session.packageDigest, packageSize: session.packageSize, dataDigest: session.dataDigest, dataSize: session.dataSize, status: session.status, outcome: session.outcome, error: session.error, createdAt: session.createdAt, updatedAt: session.updatedAt };
}

function targetError(reply: FastifyReply, error: unknown) {
  return reply.status(targetInstallStatus(error)).send({
    success: false, code: targetInstallCode(error),
    error: error instanceof AppInstallError || error instanceof AppDataError || error instanceof SyncSessionError ? error.message : "Synchronization request failed",
  });
}

function sourceError(reply: FastifyReply, error: unknown) {
  if (error instanceof SyncSourceError) return reply.status(error.statusCode).send({ success: false, code: error.code, error: error.message });
  return reply.status(400).send({ success: false, code: "SYNC_FAILED", error: error instanceof Error ? error.message : "Synchronization failed" });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new SyncSessionError("SYNC_METADATA_INVALID", `${field} is required`, 400);
  return value.trim();
}
function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new SyncSessionError("SYNC_METADATA_INVALID", `${field} must be an integer`, 400);
  return value as number;
}
function invalidMode(): never { throw new SyncSessionError("SYNC_MODE_UNSUPPORTED", "Unsupported synchronization mode", 400); }
