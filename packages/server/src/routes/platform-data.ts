import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PLATFORM_CAPABILITIES } from "@localapp/server-core";
import {
  findGroupById,
  findUserById,
  listAllUsersPlatform,
  listSystemGroups,
  validateApiKey,
} from "../lib/meta-sqlite.js";
import { CURRENT_PLATFORM_VERSION } from "../lib/platform-version.js";

const PLATFORM_ROLES = [
  { id: "admin", name: "Admin", permissions: ["*"] },
  { id: "user", name: "User", permissions: ["apps:read", "apps:create"] },
];

export async function platformDataRoutes(app: FastifyInstance) {
  app.get("/api/platform/capabilities", async () => ({
    success: true,
    data: PLATFORM_CAPABILITIES,
  }));

  app.get("/api/platform/users", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    return {
    success: true,
    data: listAllUsersPlatform(),
    };
  });

  app.get<{ Params: { id: string } }>("/api/platform/users/:id", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    const user = findUserById(req.params.id);
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  });

  app.get("/api/platform/groups", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    return {
      success: true,
      data: listSystemGroups().map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        memberCount: group.memberCount,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/platform/groups/:id", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    const group = findGroupById(req.params.id);
    if (!group) return reply.status(404).send({ success: false, error: "Group not found" });
    return {
      success: true,
      data: {
        id: group.id,
        name: group.name,
        description: group.description,
      },
    };
  });

  app.get("/api/platform/roles", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    return {
      success: true,
      data: PLATFORM_ROLES,
    };
  });

  app.get("/api/platform/version", async (req, reply) => {
    if (!requirePlatformAccess(req, reply)) return;
    return {
      success: true,
      data: {
        version: CURRENT_PLATFORM_VERSION,
      },
    };
  });

  app.all("/api/platform/*", async (req, reply) => {
    if (req.method !== "GET") {
      return reply.status(405).send({
        success: false,
        error: "Platform data is read-only",
      });
    }
    if (!requirePlatformAccess(req, reply)) return;
    return reply.status(404).send({ success: false, error: "Platform data not found" });
  });
}

function requirePlatformAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && validateApiKey(apiKey)) return true;
  if (req.visitorId) return true;
  reply.status(401).send({
    success: false,
    error: "Authentication required",
  });
  return false;
}
