import type { FastifyInstance } from "fastify";
import { adminAuth } from "../plugins/auth.js";
import type { ServerConfig } from "../lib/config.js";
import type { ServerConfigStore } from "../lib/server-config-store.js";

export type PublicSystemSettings = Pick<ServerConfig,
  "listenHost" | "listenPort" | "publicUrl" | "workspaceDir" | "allowInsecureLan"
>;

export interface RestartController {
  requestRestart(exitCode: 75): void;
}

function publicSettings(config: ServerConfig): PublicSystemSettings {
  return {
    listenHost: config.listenHost,
    listenPort: config.listenPort,
    publicUrl: config.publicUrl,
    workspaceDir: config.workspaceDir,
    allowInsecureLan: config.allowInsecureLan,
  };
}

export async function systemRoutes(
  app: FastifyInstance,
  options: { configStore: ServerConfigStore; restartController: RestartController },
): Promise<void> {
  app.get("/api/system/status", async () => ({
    success: true,
    data: { listening: true },
  }));

  await app.register(async (adminScope) => {
    await adminAuth(adminScope);

    adminScope.get("/api/system/settings", async () => ({
      success: true,
      data: publicSettings(adminScope.config),
    }));

    adminScope.put<{ Body: Partial<Pick<PublicSystemSettings, "listenHost" | "listenPort" | "allowInsecureLan">> }>(
      "/api/system/settings/network",
      async (req, reply) => {
        const candidate = await options.configStore.validate({
          ...adminScope.config,
          listenHost: req.body?.listenHost ?? adminScope.config.listenHost,
          listenPort: req.body?.listenPort ?? adminScope.config.listenPort,
          allowInsecureLan: req.body?.allowInsecureLan ?? adminScope.config.allowInsecureLan,
        });
        await options.configStore.write(candidate);
        reply.raw.once("finish", () => options.restartController.requestRestart(75));
        return reply.status(202).send({ success: true, data: { restarting: true } });
      },
    );
  });
}
