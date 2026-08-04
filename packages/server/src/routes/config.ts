import { FastifyInstance } from "fastify";

export async function configRoutes(app: FastifyInstance) {
  app.get("/api/config", async () => {
    const config = app.config;
    return {
      templateRepoUrl: config.templateRepoUrl,
      gitDownloadUrl: config.gitDownloadUrl || null,
    };
  });
}
