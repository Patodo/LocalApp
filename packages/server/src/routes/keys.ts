import { FastifyInstance } from "fastify";
import { createApiKey, listApiKeysByUser } from "../lib/meta-sqlite.js";

export async function keysRoutes(app: FastifyInstance) {
  app.post("/api/keys", async (req) => {
    const body = req.body as { userId?: string } | undefined;
    const targetUserId = body?.userId || req.userId;
    if (!targetUserId) {
      return { success: false, error: "userId is required" };
    }

    const record = createApiKey(targetUserId);
    return { success: true, data: record };
  });

  app.get("/api/keys", async (req) => {
    const keys = listApiKeysByUser(req.userId);
    return { success: true, data: keys };
  });
}
