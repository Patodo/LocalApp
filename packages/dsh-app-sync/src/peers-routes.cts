import { timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inspectAppPackage, MAX_APP_PACKAGE_BYTES } from "@localapp/app-foundation/app-package";
import { installAppPackage } from "@localapp/app-foundation/app-installer";
import { readPageMeta } from "@localapp/app-foundation/page-storage";
import { validateName } from "@localapp/app-foundation/validate-name";
import type { FastifyRequest } from "fastify";
import type { FastifyInstance, FastifyReply } from "fastify";
import { checkPeerCapabilities, normalizePeerUrl } from "@localapp/dsh-app-sync/peer-client";
import { PeerStore } from "@localapp/dsh-app-sync/peer-store";

type PeerRequestBody = {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  acceptInsecureHttp?: unknown;
};

export async function registerPeers(app: FastifyInstance, peerStore: PeerStore, authenticate: (app: FastifyInstance) => Promise<void>, catalog?: { dataDir: string; desktopControlToken?: string; userId(request: FastifyRequest): string }): Promise<void> {
  await app.register(async (adminScope) => {
    await authenticate(adminScope);

    adminScope.get("/api/peers", async () => ({ success: true, data: peerStore.listPublic() }));

    if (catalog) {
      const targetFetch = (target: NonNullable<ReturnType<PeerStore["loadForCheck"]>>, route: string) => fetch(target.baseUrl + route, {
        headers: { authorization: `Bearer ${target.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(60_000),
      });
      adminScope.get<{ Params: { id: string } }>("/api/peers/:id/apps", async (req, reply) => {
        try {
          const target = peerStore.loadForCheck(req.params.id);
          if (!target) return reply.code(404).send({ success: false, error: "对端不存在" });
          const response = await targetFetch(target, "/api/peer/apps");
          if (!response.ok) return reply.code(502).send({ success: false, error: response.status === 404 ? "对端版本不支持应用浏览" : "无法读取对端应用，请检查凭据" });
          const payload = await response.json();
          if (!payload.success || !Array.isArray(payload.data)) throw new Error("Invalid catalog");
          const apps = payload.data.filter((item: { owner?: unknown; name?: unknown; digest?: unknown }) =>
            typeof item?.owner === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(item.owner)
            && typeof item.name === "string" && !validateName(item.name)
            && typeof item.digest === "string" && /^[a-f0-9]{64}$/.test(item.digest));
          return { success: true, data: apps.map(({ owner, name, description, version, digest }: Record<string, string>) => ({
            owner, name, description, version, digest,
          })) };
        } catch {
          return reply.code(502).send({ success: false, error: "无法连接对端应用目录" });
        }
      });
      adminScope.get<{ Params: { id: string; name: string } }>("/api/peers/:id/apps/:name/shadow", async (req, reply) => {
        const { id, name } = req.params;
        if (validateName(name)) return reply.code(400).send({ success: false, error: "无效的应用名称" });
        try {
          const target = peerStore.loadForCheck(id);
          if (!target) return reply.code(404).send({ success: false, error: "对端不存在" });
          const base = new URL(target.baseUrl);
          if (base.protocol !== "https:" || base.pathname !== "/") {
            return reply.code(400).send({ success: false, error: "影子模式需要 HTTPS 根地址的对端" });
          }
          const response = await targetFetch(target, "/api/peer/apps");
          const payload = response.ok ? await response.json() : null;
          const app = Array.isArray(payload?.data) && payload.data.find((item: { name?: unknown }) => item?.name === name);
          if (!app || typeof app.owner !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(app.owner)) {
            return reply.code(404).send({ success: false, error: "对端应用不可用" });
          }
          return { success: true, data: { url: `${base.origin}/${app.owner}/${name}` } };
        } catch {
          return reply.code(502).send({ success: false, error: "无法连接对端应用" });
        }
      });
      adminScope.post<{ Params: { id: string; name: string } }>("/api/peers/:id/apps/:name/shadow-session", async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        const control = req.headers["x-localapp-desktop-control"];
        const expected = catalog.desktopControlToken;
        if (typeof control !== "string" || !expected || Buffer.byteLength(control) !== Buffer.byteLength(expected)
          || !timingSafeEqual(Buffer.from(control), Buffer.from(expected))) {
          return reply.code(403).send({ success: false, error: "仅桌面客户端可建立影子会话" });
        }
        const { id, name } = req.params;
        if (validateName(name)) return reply.code(400).send({ success: false, error: "无效的应用名称" });
        try {
          const target = peerStore.loadForCheck(id);
          if (!target || !target.baseUrl.startsWith("https://")) return reply.code(404).send({ success: false, error: "HTTPS 对端不可用" });
          const response = await fetch(target.baseUrl + `/api/peer/apps/${name}/shadow-session`, {
            method: "POST", headers: { authorization: `Bearer ${target.apiKey}` },
            redirect: "error", signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) return reply.code(502).send({ success: false, error: response.status === 404
            ? "远端尚未支持影子身份，请升级远端 LocalApp" : "远端拒绝了对端 API Key" });
          const result = await response.json();
          return { success: true, data: result.data };
        } catch {
          return reply.code(502).send({ success: false, error: "无法建立远端影子会话" });
        }
      });
      adminScope.post<{ Params: { id: string; name: string }; Body: { digest?: string } }>("/api/peers/:id/apps/:name/copy", async (req, reply) => {
        const { name, id } = req.params;
        const digest = req.body?.digest;
        if (validateName(name) || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
          return reply.code(400).send({ success: false, error: "无效的应用版本" });
        }
        let staging: string | undefined;
        try {
          const target = peerStore.loadForCheck(id);
          if (!target) return reply.code(404).send({ success: false, error: "对端不存在" });
          const ownerId = catalog.userId(req);
          if (readPageMeta(catalog.dataDir, ownerId, name)) {
            return reply.code(409).send({ success: false, error: "本机已有同名应用" });
          }
          const response = await targetFetch(target, `/api/peer/apps/${name}/package?digest=${digest}`);
          if (!response.ok || !response.body) return reply.code(502).send({ success: false, error: "无法下载对端应用包，请刷新应用列表" });
          const directory = path.join(catalog.dataDir, ".staging");
          await mkdir(directory, { recursive: true });
          staging = await mkdtemp(path.join(directory, "peer-copy-"));
          const packagePath = path.join(staging, "application.localapp");
          let size = 0;
          const limit = new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length;
              callback(size > MAX_APP_PACKAGE_BYTES ? new Error("Package too large") : null, chunk);
            },
          });
          await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), limit, createWriteStream(packagePath, { mode: 0o600 }));
          const downloaded = await inspectAppPackage(packagePath);
          if (downloaded.name !== name || downloaded.digest !== digest) throw new Error("Package does not match published application");
          const installed = await installAppPackage({ dataDir: catalog.dataDir, ownerId, packagePath, expectedLocalVersion: 0, preserveTargetAccess: true });
          return reply.code(201).send({ success: true, data: installed });
        } catch {
          return reply.code(409).send({ success: false, error: "复制失败，请确认远端版本及本机同名应用" });
        } finally {
          if (staging) await rm(staging, { recursive: true, force: true });
        }
      });
    }

    adminScope.post("/api/peers", async (req, reply) => {
      try {
        const body = req.body as PeerRequestBody | undefined;
        const name = requiredName(body?.name);
        const apiKey = requiredApiKey(body?.apiKey);
        const peerUrl = normalizePeerUrl(requiredString(body?.baseUrl, "baseUrl"), body?.acceptInsecureHttp === true);
        const peer = peerStore.create({ name, apiKey, ...peerUrl });
        return reply.status(201).send({ success: true, data: peer });
      } catch (error) {
        return peerError(reply, error);
      }
    });

    adminScope.patch<{ Params: { id: string } }>("/api/peers/:id", async (req, reply) => {
      try {
        const body = req.body as PeerRequestBody | undefined;
        if (!body || Object.keys(body).length === 0) throw new Error("At least one peer setting is required");
        const existing = peerStore.getPublic(req.params.id);
        if (!existing) return reply.status(404).send({ success: false, error: "Peer not found" });
        const input: { name?: string; baseUrl?: string; apiKey?: string; acceptInsecureHttp?: boolean } = {};
        if (body.name !== undefined) input.name = requiredName(body.name);
        if (body.apiKey !== undefined) input.apiKey = requiredApiKey(body.apiKey);
        if (body.baseUrl !== undefined || body.acceptInsecureHttp !== undefined) {
          const url = normalizePeerUrl(
            body.baseUrl === undefined ? existing.baseUrl : requiredString(body.baseUrl, "baseUrl"),
            body.acceptInsecureHttp === undefined ? existing.acceptInsecureHttp : body.acceptInsecureHttp === true,
          );
          input.baseUrl = url.baseUrl;
          input.acceptInsecureHttp = url.acceptInsecureHttp;
        }
        const peer = peerStore.update(req.params.id, input);
        return { success: true, data: peer };
      } catch (error) {
        return peerError(reply, error);
      }
    });

    adminScope.delete<{ Params: { id: string } }>("/api/peers/:id", async (req, reply) => {
      if (!peerStore.remove(req.params.id)) return reply.status(404).send({ success: false, error: "Peer not found" });
      return reply.status(204).send();
    });

    adminScope.post<{ Params: { id: string } }>("/api/peers/:id/check", async (req, reply) => {
      let target;
      try {
        target = peerStore.loadForCheck(req.params.id);
      } catch {
        return reply.status(502).send({ success: false, error: "Peer capability check failed" });
      }
      if (!target) return reply.status(404).send({ success: false, error: "Peer not found" });
      let verification;
      try {
        verification = await checkPeerCapabilities(target.baseUrl, target.apiKey);
      } catch {
        return reply.status(502).send({ success: false, error: "Peer capability check failed" });
      }
      const persisted = peerStore.recordVerification(target, verification);
      if (persisted.kind !== "updated") {
        if (persisted.kind === "missing") return reply.status(404).send({ success: false, error: "Peer not found" });
        return reply.status(409).send({ success: false, error: "Peer configuration changed during capability check" });
      }
      return { success: true, data: persisted.peer };
    });
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function requiredName(value: unknown): string {
  const name = requiredString(value, "name");
  if (name.length > 80) throw new Error("name must be at most 80 characters");
  return name;
}

function requiredApiKey(value: unknown): string {
  const apiKey = requiredString(value, "apiKey");
  if (apiKey.length > 1024) throw new Error("apiKey is too long");
  return apiKey;
}

function peerError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "Invalid peer request";
  if (message.includes("UNIQUE constraint")) return reply.status(409).send({ success: false, error: "Peer name already exists" });
  return reply.status(400).send({ success: false, error: message });
}
