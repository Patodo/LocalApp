import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getUserRole, listGroupsByUser } from "../lib/meta-sqlite.js";
import { readScheduledScripts, scheduleScriptChecks } from "../lib/scheduled-scripts.js";
import { requireRequestUser } from "../plugins/auth.js";

function requireApiUser(request: FastifyRequest, reply: FastifyReply): string | null {
  if (typeof request.headers["x-api-key"] === "string" && request.headers["x-api-key"]) {
    return requireRequestUser(request, reply);
  }
  reply.code(401).send({ success: false, error: "API key required" });
  return null;
}

function scriptAccess(userId: string): (groupId: string | undefined) => boolean {
  if (getUserRole(userId) === "admin") return () => true;
  const groups = listGroupsByUser(userId);
  return groupId => groups.some(group =>
    group.id === groupId && !group.system && getUserRole(group.creatorId) === "admin",
  );
}

export async function scheduledScriptRoutes(app: FastifyInstance, filename: string, env: NodeJS.ProcessEnv) {
  const scripts = await readScheduledScripts(filename, env);
  const route = "/api/system/scheduled-scripts";
  let stopChecks: (() => void) | undefined;
  let closing = false;
  app.addHook("onListen", async () => {
    if (scripts.size > 0) stopChecks = scheduleScriptChecks(scripts.values());
  });
  app.addHook("preClose", async () => {
    closing = true;
    stopChecks?.();
    await Promise.all(Array.from(scripts.values(), script => script.stop()));
  });

  app.get(route, async (request, reply) => {
    const userId = requireApiUser(request, reply);
    if (!userId) return;
    const hasAccess = scriptAccess(userId);
    const data = Array.from(scripts.values()).filter(script => hasAccess(script.groupId)).map(script => script.summary());
    return reply.header("Cache-Control", "no-store").send({ success: true, data });
  });

  app.post<{ Params: { id: string } }>(`${route}/:id/run`, async (request, reply) => {
    const userId = requireApiUser(request, reply);
    if (!userId) return;
    const script = scripts.get(request.params.id);
    if (!script || !scriptAccess(userId)(script.groupId)) {
      return reply.code(404).send({ success: false, error: "Scheduled script not found" });
    }
    if (!script.allowsManualRun(request.headers["x-localapp-script-token"])) {
      return reply.code(403).send({ success: false, error: "Manual run requires a valid script token" });
    }
    if (request.body !== undefined || Object.keys(request.query as object).length > 0) {
      return reply.code(400).send({ success: false, error: "Scheduled scripts do not accept run arguments" });
    }
    if (closing) return reply.code(503).send({ success: false, error: "Server is stopping" });
    if (!script.run("manual")) return reply.code(409).send({ success: false, error: "Scheduled script is already running" });
    return reply.code(202).send({ success: true, data: script.summary() });
  });
}
