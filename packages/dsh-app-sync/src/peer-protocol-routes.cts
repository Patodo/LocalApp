export interface PeerProtocolHost {
  dataDir?: string;
  desktopControlToken?: string;
  shadowSession?(apiKey: string, id: string, owner: string, name: string): { ticket: string; expiresIn: number };
  keyOwner(key: string): string | null;
  user(id: string): { id: string; name: string; displayName: string | null } | null;
}
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getPageDir, readPageMeta } from "@localapp/app-foundation/page-storage";
import { validateName } from "@localapp/app-foundation/validate-name";
import { inspectAppPackage, MAX_APP_PACKAGE_BYTES } from "@localapp/app-foundation/app-package";

export const PEER_PROTOCOL_VERSION = 2;

export async function registerPeerProtocol(app: FastifyInstance, host: PeerProtocolHost): Promise<void> {
  function identify(authorization: unknown) {
    const match = typeof authorization === "string" ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
    const userId = match ? host.keyOwner(match[1]) : null;
    return userId ? host.user(userId) : null;
  }
  app.get("/api/peer/capabilities", async (req, reply) => {
    const user = identify(req.headers.authorization);
    if (!user) return reply.status(401).send({ success: false, error: "Authentication required" });
    return {
      success: true,
      data: {
        protocolVersion: PEER_PROTOCOL_VERSION,
        user: { id: user.id, name: user.name, displayName: user.displayName },
        transferLimits: { maxPackageBytes: MAX_APP_PACKAGE_BYTES },
      },
    };
  });

  const dataDir = host.dataDir;
  if (!dataDir) return;
  app.get("/api/peer/apps", async (req, reply) => {
    const user = identify(req.headers.authorization);
    if (!user) return reply.code(401).send({ success: false, error: "Authentication required" });
    const dir = path.join(dataDir, user.id);
    const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const apps = entries.filter(entry => entry.isDirectory() && !validateName(entry.name)).flatMap(entry => {
      const meta = readPageMeta(dataDir, user.id, entry.name);
      const version = meta?.versions.find(item => item.version === meta.currentVersion);
      if (!meta || !version?.packagePath || !version.appVersion || !version.digest) return [];
      return [{ name: entry.name, owner: user.name, description: meta.description, version: version.appVersion, digest: version.digest }];
    });
    return { success: true, data: apps };
  });
  app.post<{ Params: { name: string } }>("/api/peer/apps/:name/shadow-session", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!host.shadowSession) return reply.code(404).send({ success: false });
    const user = identify(req.headers.authorization);
    if (!user) return reply.code(401).send({ success: false, error: "Authentication required" });
    const { name } = req.params;
    const meta = !validateName(name) && readPageMeta(dataDir, user.id, name);
    if (!meta || !meta.currentVersion || !/^[A-Za-z0-9_-]{1,80}$/.test(user.name)) {
      return reply.code(404).send({ success: false, error: "Published application unavailable" });
    }
    const apiKey = req.headers.authorization!.slice("Bearer ".length);
    return { success: true, data: host.shadowSession(apiKey, user.id, user.name, name) };
  });
  app.get<{ Params: { name: string }; Querystring: { digest?: string } }>("/api/peer/apps/:name/package", async (req, reply) => {
    const user = identify(req.headers.authorization);
    if (!user) return reply.code(401).send({ success: false, error: "Authentication required" });
    const { name } = req.params;
    const meta = !validateName(name) && readPageMeta(dataDir, user.id, name);
    const version = meta ? meta.versions.find(item => item.version === meta.currentVersion) : undefined;
    const root = path.join(getPageDir(dataDir, user.id, name), ".packages");
    const filename = version?.packagePath && path.resolve(path.dirname(root), version.packagePath);
    if (!filename || path.dirname(filename) !== root) return reply.code(404).send({ success: false, error: "Application package unavailable" });
    if (!version?.digest || req.query.digest !== version.digest) return reply.code(409).send({ success: false, error: "Application version changed" });
    const inspected = await inspectAppPackage(filename).catch(() => null);
    if (!inspected || inspected.digest !== version.digest) return reply.code(409).send({ success: false, error: "Application package changed" });
    reply.header("Cache-Control", "no-store").header("Content-Length", (await stat(filename)).size);
    return reply.type("application/octet-stream").send(createReadStream(filename));
  });
}
