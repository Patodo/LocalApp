import type {} from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  activateAppVersion,
  AppInstallError,
  installAppPackage,
  rollbackAppVersion,
} from "./app-installer.cjs";
import { MAX_APP_PACKAGE_BYTES } from "./app-package.cjs";
import { getPageDir, getPageMetaPath, readPageMeta, writePageMeta, type PageMeta } from "./page-storage.cjs";
import { withAppDataMaintenance } from "@localapp/app-foundation/app-data-maintenance";
import { validateName } from "./validate-name.cjs";

export interface ApplicationInstallHost {
  dataDir: string;
  userId(request: unknown): string;
  user(userId: string): { displayName?: string | null } | undefined | null;
}

export async function registerApplicationInstall(app: FastifyInstance, host: ApplicationInstallHost) {
  async function upload(req: FastifyRequest, reply: FastifyReply, target?: { owner: string; name: string }) {
    const actor = host.userId(req);
    if (target) {
      const meta = readPageMeta(host.dataDir, target.owner, target.name);
      if (meta?.userId !== target.owner || !meta.coDevelopers?.includes(actor)) {
        return reply.code(403).send({ success: false, error: "你没有此应用的更新权限" });
      }
    }
    const uploadDir = path.join(host.dataDir, ".staging", "app-uploads", crypto.randomUUID());
    const packagePath = path.join(uploadDir, "application.localapp");
    fs.mkdirSync(uploadDir, { recursive: true });
    try {
      let received = false;
      const parts = req.parts({ limits: { files: 1, fileSize: MAX_APP_PACKAGE_BYTES } });
      for await (const part of parts) {
        if (part.type !== "file") continue;
        if (received || part.fieldname !== "package") {
          part.file.resume();
          throw new AppInstallError("APP_PACKAGE_REQUIRED", "Exactly one package file is required", 400);
        }
        if (path.extname(part.filename).toLowerCase() !== ".localapp") {
          part.file.resume();
          throw new AppInstallError("APP_PACKAGE_REQUIRED", "Application package filename must end in .localapp", 400);
        }
        received = true;
        await pipeline(part.file, fs.createWriteStream(packagePath, { flags: "wx", mode: 0o600 }));
        if (part.file.truncated) {
          throw new AppInstallError("APP_PACKAGE_TOO_LARGE", `Application package exceeds ${MAX_APP_PACKAGE_BYTES} bytes`, 413);
        }
      }
      if (!received) throw new AppInstallError("APP_PACKAGE_REQUIRED", "Application package file is required", 400);
      const user = host.user(actor);
      const outcome = await installAppPackage({
        dataDir: host.dataDir,
        ownerId: target?.owner ?? actor,
        uploaderId: actor,
        ...(target ? {
          requireExisting: true,
          preserveTargetAccess: true,
          expectedName: target.name,
          authorizeUpdate(meta) {
            if (meta?.userId !== target.owner || !meta.coDevelopers?.includes(actor)) throw new AppInstallError("APP_UPDATE_FORBIDDEN", "你没有此应用的更新权限", 403);
          },
        } : {}),
        packagePath,
        ...(user?.displayName ? { uploaderDisplayName: user.displayName } : {}),
      });
      return reply.status(outcome.idempotent ? 200 : 201).send({ success: true, data: outcome });
    } catch (error) {
      return sendInstallError(reply, error);
    } finally {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
  }

  app.post("/api/me/apps/install", (req, reply) => upload(req, reply));

  app.post<{ Params: { owner: string; name: string } }>("/api/me/shared-apps/:owner/:name/update", (req, reply) => {
    const { owner, name } = req.params;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(owner) || validateName(name)) {
      return reply.code(400).send({ success: false, error: "无效的应用地址" });
    }
    return upload(req, reply, { owner, name });
  });

  app.get("/api/me/shared-apps", async req => {
    const actor = host.userId(req);
    const data = [];
    for (const owner of await fs.promises.readdir(host.dataDir, { withFileTypes: true })) {
      if (!owner.isDirectory() || owner.name === actor || !/^[A-Za-z0-9_-]{1,80}$/.test(owner.name)) continue;
      const entries = await fs.promises.readdir(path.join(host.dataDir, owner.name), { withFileTypes: true }).catch(error => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const app of entries) {
        if (!app.isDirectory() || validateName(app.name)) continue;
        try {
          const raw = await fs.promises.readFile(getPageMetaPath(host.dataDir, owner.name, app.name), "utf8");
          const meta = JSON.parse(raw) as PageMeta;
          if (meta.userId === owner.name && meta.coDevelopers?.includes(actor)) {
            data.push({ owner: owner.name, name: app.name, version: meta.currentAppVersion ?? String(meta.currentVersion) });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            req.log.warn({ err: error, owner: owner.name, app: app.name }, "Failed to read shared application");
          }
        }
      }
    }
    return { success: true, data };
  });

  app.get<{ Params: { name: string } }>("/api/me/apps/:name/co-developers", (req, reply) => {
    const { name } = req.params;
    const owner = host.userId(req);
    const meta = !validateName(name) && readPageMeta(host.dataDir, owner, name);
    if (!meta || meta.userId !== owner) return reply.code(404).send({ success: false, error: "应用不存在" });
    return { success: true, data: meta.coDevelopers ?? [] };
  });

  for (const method of ["PUT", "DELETE"] as const) {
    app.route<{ Params: { name: string; userId: string } }>({
      method,
      url: "/api/me/apps/:name/co-developers/:userId",
      async handler(req, reply) {
        const { name, userId } = req.params;
        const owner = host.userId(req);
        if (validateName(name) || userId === owner || !userId) {
          return reply.code(400).send({ success: false, error: "请选择其他用户" });
        }
        if (method === "PUT" && !host.user(userId)) {
          return reply.code(404).send({ success: false, error: "用户不存在" });
        }
        return withAppDataMaintenance(getPageDir(host.dataDir, owner, name), async () => {
          const meta = readPageMeta(host.dataDir, owner, name);
          if (!meta || meta.userId !== owner) return reply.code(404).send({ success: false, error: "应用不存在" });
          const members = new Set(meta.coDevelopers ?? []);
          if (method === "PUT") members.add(userId);
          else members.delete(userId);
          meta.coDevelopers = [...members];
          writePageMeta(host.dataDir, owner, name, meta);
          return { success: true, data: meta.coDevelopers };
        });
      },
    });
  }

  app.get<{ Params: { name: string } }>("/api/me/apps/:name/versions", async (req, reply) => {
    const nameError = validateName(req.params.name);
    if (nameError) return reply.status(400).send({ success: false, code: "APP_NAME_INVALID", error: nameError });
    const meta = readPageMeta(host.dataDir, host.userId(req), req.params.name);
    if (!meta) return reply.status(404).send({ success: false, code: "APP_NOT_FOUND", error: "Application not found" });
    return {
      success: true,
      data: {
        name: meta.name,
        currentVersion: meta.currentVersion,
        currentAppVersion: meta.currentAppVersion ?? null,
        versions: meta.versions,
      },
    };
  });

  app.post<{ Params: { name: string; version: string } }>("/api/me/apps/:name/versions/:version/activate", async (req, reply) => {
    const nameError = validateName(req.params.name);
    if (nameError) return reply.status(400).send({ success: false, code: "APP_NAME_INVALID", error: nameError });
    const localVersion = Number(req.params.version);
    if (!Number.isSafeInteger(localVersion) || localVersion < 1) {
      return reply.status(400).send({ success: false, code: "APP_VERSION_INVALID", error: "Version must be a positive deployment sequence" });
    }
    try {
      const outcome = await activateAppVersion({
        dataDir: host.dataDir,
        ownerId: host.userId(req),
        name: req.params.name,
        localVersion,
      });
      return { success: true, data: outcome };
    } catch (error) {
      return sendInstallError(reply, error);
    }
  });

  app.post<{ Params: { name: string } }>("/api/me/apps/:name/rollback", async (req, reply) => {
    const nameError = validateName(req.params.name);
    if (nameError) return reply.status(400).send({ success: false, code: "APP_NAME_INVALID", error: nameError });
    try {
      const outcome = await rollbackAppVersion({
        dataDir: host.dataDir,
        ownerId: host.userId(req),
        name: req.params.name,
      });
      return { success: true, data: outcome };
    } catch (error) {
      return sendInstallError(reply, error);
    }
  });
}

function sendInstallError(
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
  error: unknown,
): unknown {
  if (error instanceof AppInstallError) {
    return reply.status(error.statusCode).send({
      success: false,
      code: error.code,
      ...(error.path ? { path: error.path } : {}),
      error: error.message,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return reply.status(400).send({ success: false, code: "APP_INSTALL_FAILED", error: message });
}
