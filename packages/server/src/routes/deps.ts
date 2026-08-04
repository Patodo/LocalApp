import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

const DEPS_DIR = path.resolve(process.cwd(), "static", "deps");

function readNodeJson(): Record<string, unknown> | null {
  const p = path.join(DEPS_DIR, "node.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export async function depsRoutes(app: FastifyInstance) {
  app.get("/api/deps/node", async (_req, reply) => {
    const info = readNodeJson();
    if (!info) {
      return reply.status(404).send({ success: false, error: "Node.js installer not available" });
    }
    return info;
  });

  app.get<{ Querystring: { os?: string; arch?: string } }>(
    "/api/deps/node/download",
    async (req, reply) => {
      const { os, arch } = req.query;
      if (!os || !arch) {
        return reply.status(400).send({ success: false, error: "os and arch query params are required" });
      }

      const info = readNodeJson();
      if (!info) {
        return reply.status(404).send({ success: false, error: "Node.js installer not available" });
      }

      const platformKey = `${os}/${arch}`;
      const platforms = (info as Record<string, unknown>).platforms as Record<string, string> | undefined;
      if (!platforms || !platforms[platformKey]) {
        return reply.status(404).send({ success: false, error: `No installer for platform: ${platformKey}` });
      }

      const filename = platforms[platformKey];
      const version = (info as Record<string, unknown>).version as string;
      const binPath = path.join(DEPS_DIR, "node", version, filename);

      if (!fs.existsSync(binPath)) {
        return reply.status(404).send({ success: false, error: "Installer file not found on server" });
      }

      return reply
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .type("application/octet-stream")
        .send(fs.createReadStream(binPath));
    },
  );
}
