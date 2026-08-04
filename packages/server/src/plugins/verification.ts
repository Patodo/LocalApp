import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { VerificationSessionStore } from "../lib/verification-sessions.js";

declare module "fastify" {
  interface FastifyInstance {
    verificationSessions: VerificationSessionStore;
  }
}

async function verification(app: FastifyInstance) {
  const store = new VerificationSessionStore(app.config.dataDir);
  store.initialize();
  app.decorate("verificationSessions", store);
  const cleanupTimer = setInterval(() => store.cleanupExpired(), 30_000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));
}

export const verificationPlugin = fp(verification, {
  name: "verification",
  dependencies: ["storage"],
});
