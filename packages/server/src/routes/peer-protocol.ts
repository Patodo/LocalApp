import type { FastifyInstance } from "fastify";
import { findUserById, validateApiKey } from "../lib/meta-sqlite.js";
import { MAX_APP_PACKAGE_BYTES } from "../lib/app-package.js";

const PROTOCOL_VERSION = 1;

export async function peerProtocolRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/peer/capabilities", async (req, reply) => {
    const authorization = req.headers.authorization;
    const match = typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    const userId = match ? validateApiKey(match[1]) : null;
    if (!userId) return reply.status(401).send({ success: false, error: "Authentication required" });
    const user = findUserById(userId);
    if (!user) return reply.status(401).send({ success: false, error: "Authentication required" });
    return {
      success: true,
      data: {
        protocolVersion: PROTOCOL_VERSION,
        user: { id: user.id, name: user.name, displayName: user.displayName },
        transferLimits: { maxPackageBytes: MAX_APP_PACKAGE_BYTES },
      },
    };
  });
}
