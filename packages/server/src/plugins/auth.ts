import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { initMetaDb, validateApiKey, getUserRole, findUserById } from "../lib/meta-sqlite.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

const SKIP_VERSION_CHECK = ["/api/cli/version", "/api/cli/download"];

export type RequestUserResolution =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid-api-key" | "missing-credentials" };

export function resolveRequestUser(req: FastifyRequest): RequestUserResolution {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string") {
    const userId = validateApiKey(apiKey);
    return userId
      ? { ok: true, userId }
      : { ok: false, reason: "invalid-api-key" };
  }

  if (req.visitorId) {
    return { ok: true, userId: req.visitorId };
  }

  return { ok: false, reason: "missing-credentials" };
}

export function requireRequestUser(
  req: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const resolution = resolveRequestUser(req);
  if (resolution.ok) return resolution.userId;

  reply.status(401).send({
    success: false,
    error: resolution.reason === "invalid-api-key"
      ? "Invalid API key"
      : "Authentication required",
  });
  return null;
}

export async function authPlugin(app: FastifyInstance) {
  const config = app.config;
  await initMetaDb(config.dataDir);

  app.decorateRequest("userId", "");

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const resolution = resolveRequestUser(req);
    if (resolution.ok) {
      req.userId = resolution.userId;
      return;
    }

    return reply.status(401).send({
      success: false,
      error: resolution.reason === "invalid-api-key" ? "Invalid API key" : "API key required",
    });
  });
}

export async function adminAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    let userId: string | null = null;

    // Try API key auth
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (apiKey) {
      userId = validateApiKey(apiKey);
    }

    // Try cookie session auth
    if (!userId && req.visitorId) {
      userId = req.visitorId;
    }

    if (!userId) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }

    const role = getUserRole(userId);
    if (role !== "admin") {
      return reply.status(403).send({ success: false, error: "Admin access required" });
    }

    req.userId = userId;
  });
}

export function registerVersionCheck(app: FastifyInstance) {
  const minVersion = app.config.minCliVersion;
  if (!minVersion) return;

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (SKIP_VERSION_CHECK.includes(req.routeOptions.url ?? "")) {
      return;
    }

    // Skip version check for session-authenticated requests (browser access)
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey && req.visitorId) {
      return;
    }

    const cliVersion = req.headers["x-cli-version"] as string | undefined;
    if (!cliVersion) {
      return reply.status(403).send({
        success: false,
        error: "CLI version unknown. Run `localapp update` to upgrade.",
      });
    }

    if (compareVersions(cliVersion, minVersion!) < 0) {
      return reply.status(403).send({
        success: false,
        error: `CLI version ${cliVersion} is outdated. Minimum required: ${minVersion}. Run \`localapp update\` to upgrade.`,
      });
    }
  });
}
