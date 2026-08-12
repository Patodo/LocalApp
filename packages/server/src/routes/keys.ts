import { FastifyInstance } from "fastify";
import { createApiKey, getUserRole, listApiKeysByUser } from "../lib/meta-sqlite.js";

export async function keysRoutes(app: FastifyInstance) {
  app.post("/api/keys", async (req, reply) => {
    const body = req.body as { userId?: unknown } | undefined;
    if (body && Object.prototype.hasOwnProperty.call(body, "userId")
      && (typeof body.userId !== "string" || body.userId.length === 0)) {
      return reply.status(400).send({
        success: false,
        code: "API_KEY_INVALID_USER_ID",
        error: "userId must be a non-empty string",
      });
    }
    const targetUserId = typeof body?.userId === "string" ? body.userId : req.userId;
    if (!targetUserId) {
      return { success: false, error: "userId is required" };
    }
    if (targetUserId !== req.userId && getUserRole(req.userId) !== "admin") {
      return reply.status(403).send({
        success: false,
        code: "API_KEY_USER_MISMATCH",
        error: "A user may only create an API key for their own account",
      });
    }

    const record = createApiKey(targetUserId);
    return { success: true, data: record };
  });

  app.get("/api/keys", async (req) => {
    const keys = listApiKeysByUser(req.userId);
    return { success: true, data: keys };
  });
}
