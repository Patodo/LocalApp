import path from "node:path";
import fs from "node:fs";
import { resolveWorkspacePath } from "../lib/workspace-path.js";
import { randomUUID, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ProjectStore, DevelopmentError, sourceBytes, sourceDisplay, type SourceFile } from "../lib/development/projects.js";
import { DevelopmentBuilds } from "../lib/development/builds.js";
import { DevelopmentPreviews } from "../lib/development/previews.js";
import { DevelopmentReleases } from "../lib/development/releases.js";
import { readPageMeta } from "../plugins/storage.js";
import { validateName } from "../lib/validate-name.js";
import { templateSource } from "../lib/development/template.js";
import { AgentSettingsStore } from "../lib/agent-settings.js";
import { readPythonEnvironment } from "../lib/python-environment.js";
import type { DeepSeekHarness } from "../lib/deepseek-harness.mjs" with { "resolution-mode": "import" };

export async function developmentRoutes(
  app: FastifyInstance,
  options: {
    projects: ProjectStore;
    builds: DevelopmentBuilds;
    previews: DevelopmentPreviews;
  },
) {
  const projects = options.projects,
    settings = new AgentSettingsStore(app.config.dataDir);
  const runtimes = new Map<
    string,
    { providerHash: string; harness: DeepSeekHarness }
  >();
  app.addHook("onClose", async () => {
    await Promise.all([...runtimes.values()].map((r) => r.harness.close()));
  });
  app.setErrorHandler((error, _req, reply) => {
    reply
      .status(error instanceof DevelopmentError ? error.status : 400)
      .send({ success: false, error: error.message });
  });
  const base = "/api/development/projects";
  const releases = new DevelopmentReleases(
    app.config.dataDir,
    projects,
    options.builds,
  );
  // An app's source is never inferred from its compiled assets.
  const appSource = "/api/development/apps/:owner/:name/source";
  function ownedApp(owner: string, name: string, user: string) {
    if (owner !== user)
      throw new DevelopmentError("只有应用拥有者可以编辑应用", 403);
    if (validateName(name)) throw new DevelopmentError("应用名称无效");
    if (!readPageMeta(app.config.dataDir, user, name))
      throw new DevelopmentError("应用不存在", 404);
  }
  app.get<{ Params: { owner: string; name: string } }>(
    appSource,
    async (req) => {
      ownedApp(req.params.owner, req.params.name, req.userId);
      return {
        success: true,
        data:
          projects.list(req.userId).find((p) => p.name === req.params.name) ??
          null,
      };
    },
  );
  app.post<{
    Params: { owner: string; name: string };
    Body: { files: Record<string, SourceFile> };
  }>(appSource, { bodyLimit: 40 * 1024 * 1024 }, async (req) => {
    ownedApp(req.params.owner, req.params.name, req.userId);
    const files = req.body?.files;
    if (
      !files ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      Object.keys(files).length > 5000 ||
      Object.values(files).some(
        (v) => sourceBytes(v).length > 2 * 1024 * 1024,
      ) ||
      Buffer.byteLength(JSON.stringify(files)) > 32 * 1024 * 1024
    )
      throw new DevelopmentError("源码文件无效或超过大小限制");
    let manifest, pkg;
    try {
      manifest = JSON.parse(sourceBytes(files["manifest.json"]).toString("utf8"));
      pkg = JSON.parse(sourceBytes(files["package.json"]).toString("utf8"));
    } catch {
      throw new DevelopmentError(
        "请选择包含 manifest.json 和 package.json 的应用源码目录",
      );
    }
    if (
      manifest.name !== req.params.name ||
      !pkg.scripts?.test ||
      !pkg.scripts?.build
    )
      throw new DevelopmentError(
        "源码应用名称必须匹配，且保留 test 和 build 脚本",
      );
    return {
      success: true,
      data: projects.create(req.userId, req.params.name, files),
    };
  });
  app.post<{ Params: { id: string } }>(
    base + "/:id/attachments",
    async (req) => {
      const unlock = projects.lock(req.params.id, req.userId);
      try {
        const root = path.join(
          projects.directory,
          req.params.id,
          "attachments",
        );
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const used = fs
          .readdirSync(root)
          .reduce(
            (sum, name) =>
              sum +
              JSON.parse(fs.readFileSync(path.join(root, name), "utf8")).size,
            0,
          );
        const part = await req.file({
          limits: { fileSize: 20 * 1024 * 1024, files: 1 },
        });
        if (!part) throw new DevelopmentError("请选择文件");
        const bytes = await part.toBuffer();
        if (part.file.truncated || used + bytes.length > 200 * 1024 * 1024)
          throw new DevelopmentError(
            "文件超过限制（单文件 20MB、项目总计 200MB）",
          );
        const id = randomUUID();
        const name = path
          .basename(part.filename.replaceAll("\\", "/"))
          .replace(/[\x00-\x1f]/g, "_")
          .slice(0, 200);
        const safeName = !name || name === "." || name === ".." ? "file" : name;
        const relative = `.localapp-attachments/${id}/${safeName}`;
        const filename = resolveWorkspacePath(
          projects.workspace(req.params.id, req.userId),
          relative,
        );
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        fs.writeFileSync(filename, bytes, { flag: "wx", mode: 0o600 });
        const data = { id, name: safeName, size: bytes.length, path: relative };
        fs.writeFileSync(path.join(root, id + ".json"), JSON.stringify(data), {
          flag: "wx",
          mode: 0o600,
        });
        return { success: true, data };
      } finally {
        unlock();
      }
    },
  );
  function attachmentPrompt(project: string, user: string, ids: unknown) {
    projects.get(project, user);
    if (ids === undefined) return "";
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    )
      throw new DevelopmentError("附件标识无效");
    return ids
      .map((id) => {
        const meta = path.join(
          projects.directory,
          project,
          "attachments",
          id + ".json",
        );
        if (!fs.existsSync(meta)) throw new DevelopmentError("附件不存在", 404);
        const file = JSON.parse(fs.readFileSync(meta, "utf8"));
        const filename = resolveWorkspacePath(
          projects.workspace(project, user),
          file.path,
        );
        if (!fs.existsSync(filename))
          throw new DevelopmentError("附件文件已丢失", 404);
        return `\n用户上传文件：${JSON.stringify(file.name)}，工作区文件路径：${JSON.stringify(file.path)}`;
      })
      .join("");
  }
  app.get<{ Params: { id: string } }>(base + "/:id/builds", async (req) => ({
    success: true,
    data: options.builds.list(req.params.id, req.userId),
  }));
  app.post<{ Params: { id: string } }>(base + "/:id/builds", async (req) => ({
    success: true,
    data: options.builds.start(req.params.id, req.userId),
  }));
  app.get<{ Params: { id: string; buildId: string } }>(
    base + "/:id/builds/:buildId",
    async (req) => ({
      success: true,
      data: options.builds.get(req.params.id, req.userId, req.params.buildId),
    }),
  );
  app.post<{ Params: { id: string; buildId: string } }>(
    base + "/:id/builds/:buildId/cancel",
    async (req) => {
      options.builds.cancel(req.params.id, req.userId, req.params.buildId);
      return { success: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { buildId: string } }>(
    base + "/:id/previews",
    async (req) => ({
      success: true,
      data: await options.previews.create(
        req.params.id,
        req.userId,
        req.body.buildId,
        `${req.protocol}://${req.headers.host}`,
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    base + "/:id/release-target",
    async (req) => ({
      success: true,
      data: releases.target(req.params.id, req.userId),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { buildId: string; expectedVersion: number; idempotencyKey: string };
  }>(base + "/:id/releases", async (req) => ({
    success: true,
    data: await releases.release(
      req.params.id,
      req.userId,
      req.body.buildId,
      req.body.expectedVersion,
      req.body.idempotencyKey,
    ),
  }));
  app.get(base, async (req) => ({
    success: true,
    data: projects.list(req.userId),
  }));
  app.post<{ Body: { name: string } }>(base, async (req, reply) => {
    if (!req.body || typeof req.body.name !== "string")
      throw new DevelopmentError("请输入项目名称");
    const project = projects.create(
      req.userId,
      req.body.name,
      templateSource(req.body.name),
    );
    return reply.status(201).send({ success: true, data: project });
  });
  app.get<{ Params: { id: string } }>(base + "/:id", async (req) => ({
    success: true,
    data: {
      ...projects.get(req.params.id, req.userId),
      busy: projects.busy(req.params.id, req.userId),
    },
  }));
  app.get<{ Params: { id: string } }>(base + "/:id/files", async (req) => ({
    success: true,
    data: projects.files(req.params.id, req.userId),
  }));
  app.get<{ Params: { id: string } }>(base + "/:id/source-manifest", async (req) => ({
    success: true,
    data: Object.entries(projects.sourceFiles(req.params.id, req.userId)).map(([file, content]) => {
      const bytes = sourceBytes(content);
      return { path: file, bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") };
    }),
  }));
  app.get<{ Params: { id: string }; Querystring: { path: string } }>(
    base + "/:id/file",
    async (req) => {
      if (typeof req.query.path !== "string")
        throw new DevelopmentError("缺少文件路径");
      return {
        success: true,
        data: projects.read(req.params.id, req.userId, req.query.path),
      };
    },
  );
  app.put<{
    Params: { id: string };
    Body: { path: string; content: string; hash: string | null };
  }>(base + "/:id/file", async (req) => {
    if (
      !req.body ||
      typeof req.body.path !== "string" ||
      typeof req.body.content !== "string" ||
      !(req.body.hash === null || typeof req.body.hash === "string")
    )
      throw new DevelopmentError("保存需要文件内容和版本摘要");
    projects.write(
      req.params.id,
      req.userId,
      req.body.path,
      req.body.content,
      req.body.hash,
    );
    return {
      success: true,
      data: projects.read(req.params.id, req.userId, req.body.path),
    };
  });
  app.get<{ Params: { id: string } }>(base + "/:id/versions", async (req) => ({
    success: true,
    data: projects.versions(req.params.id, req.userId),
  }));
  app.get<{ Params: { id: string }; Querystring: { version: string } }>(
    base + "/:id/diff",
    async (req) => {
      const previous = projects.versionFiles(
        req.params.id,
        req.userId,
        req.query.version,
      );
      const changes = [];
      const current = projects.sourceFiles(req.params.id, req.userId);
      const files = Object.keys(current);
      for (const file of new Set([...files, ...Object.keys(previous)])) {
        const after = files.includes(file)
            ? sourceDisplay(current[file])
            : null,
          before = sourceDisplay(previous[file] ?? null);
        if (before !== after) changes.push({ path: file, before, after });
      }
      return { success: true, data: changes };
    },
  );
  app.post<{ Params: { id: string }; Body: { version: string } }>(
    base + "/:id/restore",
    async (req) => ({
      success: true,
      data: projects.restore(req.params.id, req.userId, req.body.version),
    }),
  );
  const opening = new Map<string, Promise<DeepSeekHarness>>();
  async function harness(id: string, user: string, providerId?: string) {
    const key = user + ":" + id;
    const previous = opening.get(key);
    if (previous) await previous;
    const pending = openHarness(id, user, providerId);
    opening.set(key, pending);
    try {
      return await pending;
    } finally {
      if (opening.get(key) === pending) opening.delete(key);
    }
  }
  async function openHarness(id: string, user: string, providerId?: string) {
    projects.get(id, user);
    const saved = settings.read(user);
    const provider = saved.providers.find(
      (p) => p.id === (providerId ?? saved.defaultProviderId),
    );
    if (!provider) throw new DevelopmentError("请先配置模型供应商");
    const hash = createHash("sha256")
        .update(
          JSON.stringify({
            provider,
            pythonEnvironment: readPythonEnvironment(app.config.dataDir),
          }),
        )
        .digest("hex"),
      key = user + ":" + id,
      old = runtimes.get(key);
    if (old?.providerHash === hash) return old.harness;
    projects.assertIdle(id, user);
    if (old) await old.harness.close();
    const { DeepSeekHarness } = await import("../lib/deepseek-harness.mjs");
    const instance = new DeepSeekHarness({
      llmApiKey: provider.apiKey,
      llmBaseUrl: provider.baseUrl,
      llmModel: provider.model,
      protocol: provider.protocol,
      ownerId: user,
      root: path.join(projects.directory, id, "agent", user),
      workspaceRoot: projects.workspace(id, user),
      dataRoot: app.config.dataDir,
      networkBlocked: true,
      autoSessionTitles: true,
      capabilities: ["files", "skills", "terminal"],
      pythonEnvironment: readPythonEnvironment(app.config.dataDir),
    });
    await instance.initialize();
    runtimes.set(key, { providerHash: hash, harness: instance });
    return instance;
  }
  app.get<{ Params: { id: string } }>(
    base + "/:id/agent/sessions",
    async (req) => ({
      success: true,
      data: await (await harness(req.params.id, req.userId)).listSessions(),
    }),
  );
  app.get<{ Params: { id: string }; Querystring: { sessionId: string } }>(
    base + "/:id/agent/history",
    async (req) => ({
      success: true,
      data: await (
        await harness(req.params.id, req.userId)
      ).history(req.query.sessionId),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { token: string; result: unknown };
  }>(base + "/:id/agent/respond", async (req) => {
    projects.get(req.params.id, req.userId);
    const r = runtimes.get(req.userId + ":" + req.params.id);
    if (!r?.harness.result(req.userId, req.body.token, req.body.result))
      throw new DevelopmentError("交互已结束", 404);
    return { success: true };
  });
  app.post<{ Params: { id: string }; Body: { sessionId: string } }>(
    base + "/:id/agent/cancel",
    async (req) => {
      projects.get(req.params.id, req.userId);
      const r = runtimes.get(req.userId + ":" + req.params.id);
      return { success: !!r?.harness.cancel(req.userId, req.body.sessionId) };
    },
  );
  app.post<{
    Params: { id: string };
    Body: {
      prompt: string;
      sessionId?: string;
      providerId?: string;
      attachmentIds?: string[];
    };
  }>(base + "/:id/agent/run", async (req, reply) => {
    if (
      !req.body ||
      typeof req.body.prompt !== "string" ||
      !req.body.prompt.trim() ||
      req.body.prompt.length > 100000
    )
      throw new DevelopmentError("请输入开发需求");
    const uploadedFiles = attachmentPrompt(
      req.params.id,
      req.userId,
      req.body.attachmentIds,
    );
    const sessionId = req.body.sessionId ?? randomUUID();
    if (
      typeof sessionId !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)
    )
      throw new DevelopmentError("会话标识无效");
    const instance = await harness(
      req.params.id,
      req.userId,
      req.body.providerId,
    );
    const release = projects.lock(req.params.id, req.userId);
    try {
      projects.snapshot(req.params.id, req.userId, "Agent 修改前自动保存");
    } catch (error) {
      release();
      throw error;
    }
    const controller = new AbortController(),
      disconnect = () => controller.abort();
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    reply.raw.on("close", disconnect);
    const emit = (event: unknown) => {
      if (!reply.raw.destroyed)
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      emit({ type: "session", sessionId });
      await instance.run(
        req.userId,
        {
          sessionId,
          prompt: req.body.prompt + uploadedFiles,
          systemPrompt:
            "你在 LocalApp 的应用开发界面工作。当前目录是应用源码。遵循 AGENTS.md 和 LocalApp 开发 Skills；保留 Named SQL 后端，不能编写 hosted JavaScript backend。修改后说明改动和验证结果。开发命令不能访问网络；依赖和发布由平台提供。不要尝试访问平台会话、其他项目或正式应用数据。",
          tools: [],
        },
        emit,
        controller.signal,
      );
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
    } finally {
      try {
        projects.snapshot(req.params.id, req.userId, "Agent 修改后保存");
      } catch (error) {
        emit({ type: "error", message: (error as Error).message });
      }
      release();
      reply.raw.off("close", disconnect);
      reply.raw.end();
    }
  });
}
