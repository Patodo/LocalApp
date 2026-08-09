import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { createInitialAdmin, listUsers } from "../lib/meta-sqlite.js";
import type { SetupTokenStore } from "../lib/setup-token-store.js";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,32}$/;
const MIN_PASSWORD_LENGTH = 6;

export async function setupRoutes(app: FastifyInstance, setupTokens: SetupTokenStore): Promise<void> {
  app.get("/api/setup/status", async () => ({
    success: true,
    data: { required: listUsers(1, 1).total === 0 },
  }));

  app.post<{ Body: { token?: string; username?: string; password?: string } }>(
    "/api/setup/initialize",
    async (req, reply) => {
      const { token, username, password } = req.body ?? {};
      if (!token || !setupTokens.consume(token)) {
        return reply.status(410).send({ success: false, error: "Setup token has expired or was already used" });
      }
      if (listUsers(1, 1).total !== 0) {
        return reply.status(409).send({ success: false, error: "Setup has already been completed" });
      }
      if (!username || !USERNAME_REGEX.test(username)) {
        return reply.status(400).send({ success: false, error: "Invalid username format" });
      }
      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return reply.status(400).send({ success: false, error: "Password too short" });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      try {
        createInitialAdmin(username, username, passwordHash, app.config.bootstrapApiKey);
      } catch (error) {
        if (error instanceof Error && error.message === "SETUP_ALREADY_COMPLETED") {
          return reply.status(409).send({ success: false, error: "Setup has already been completed" });
        }
        throw error;
      }
      setupTokens.revokeAll();
      return reply.status(201).send({ success: true });
    },
  );
}
