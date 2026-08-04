import { FastifyInstance } from "fastify";
import {
  listInbox,
  getUnreadCount,
  markRead,
  softDelete,
  markAllRead,
} from "../lib/notifications-db.js";
import { requireRequestUser } from "../plugins/auth.js";

export async function inboxRoutes(app: FastifyInstance) {
  // GET /api/inbox?limit=&cursor=&unreadOnly=true — 分页查询
  app.get("/api/inbox", async (req, reply) => {
    const userId = requireRequestUser(req, reply);
    if (!userId) return;

    const { limit, cursor, unreadOnly } = req.query as {
      limit?: string;
      cursor?: string;
      unreadOnly?: string;
    };
    const page = listInbox(userId, {
      limit: limit ? parseInt(limit, 10) : 20,
      cursor: cursor || undefined,
      unreadOnly: unreadOnly === "true",
    });
    return { success: true, data: page };
  });

  // GET /api/inbox/unread-count — 未读计数
  app.get("/api/inbox/unread-count", async (req, reply) => {
    const userId = requireRequestUser(req, reply);
    if (!userId) return;

    return { success: true, data: { count: getUnreadCount(userId) } };
  });

  // PATCH /api/inbox/:id — 标记已读
  app.patch<{ Params: { id: string } }>("/api/inbox/:id", async (req, reply) => {
    const userId = requireRequestUser(req, reply);
    if (!userId) return;

    const { id } = req.params;
    const updated = markRead(userId, id);
    if (!updated) {
      return reply.status(404).send({ success: false, error: "Notification not found" });
    }
    return { success: true, data: updated };
  });

  // DELETE /api/inbox/:id — 软删除
  app.delete<{ Params: { id: string } }>("/api/inbox/:id", async (req, reply) => {
    const userId = requireRequestUser(req, reply);
    if (!userId) return;

    const { id } = req.params;
    const ok = softDelete(userId, id);
    if (!ok) {
      return reply.status(404).send({ success: false, error: "Notification not found" });
    }
    return { success: true, data: { deleted: true } };
  });

  // POST /api/inbox/read-all — 批量已读
  app.post("/api/inbox/read-all", async (req, reply) => {
    const userId = requireRequestUser(req, reply);
    if (!userId) return;

    const updated = markAllRead(userId);
    return { success: true, data: { updated } };
  });
}
