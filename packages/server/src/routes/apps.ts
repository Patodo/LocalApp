import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  activateAppVersion,
  AppInstallError,
  installAppPackage,
  rollbackAppVersion,
} from "../lib/app-installer.js";
import { MAX_APP_PACKAGE_BYTES } from "../lib/app-package.js";
import { findUserById } from "../lib/meta-sqlite.js";
import { readPageMeta } from "../plugins/storage.js";
import { validateName } from "../lib/validate-name.js";

export async function appsRoutes(app: FastifyInstance) {
  app.post("/api/me/apps/install", async (req, reply) => {
    const uploadDir = path.join(app.config.dataDir, ".staging", "app-uploads", crypto.randomUUID());
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
      const user = findUserById(req.userId);
      const outcome = await installAppPackage({
        dataDir: app.config.dataDir,
        ownerId: req.userId,
        packagePath,
        ...(user?.displayName ? { uploaderDisplayName: user.displayName } : {}),
      });
      return reply.status(outcome.idempotent ? 200 : 201).send({ success: true, data: outcome });
    } catch (error) {
      return sendInstallError(reply, error);
    } finally {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }
  });

  app.get<{ Params: { name: string } }>("/api/me/apps/:name/versions", async (req, reply) => {
    const nameError = validateName(req.params.name);
    if (nameError) return reply.status(400).send({ success: false, code: "APP_NAME_INVALID", error: nameError });
    const meta = readPageMeta(app.config.dataDir, req.userId, req.params.name);
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
        dataDir: app.config.dataDir,
        ownerId: req.userId,
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
        dataDir: app.config.dataDir,
        ownerId: req.userId,
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
