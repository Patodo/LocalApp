import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

async function initAndNew(dir: string, env: Awaited<ReturnType<typeof createCliTestEnv>>, name: string) {
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ name, description: "", distDir: "dist" }));
  await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
}

describe("cli-upload notify config", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;

  beforeAll(async () => {
    env = await createCliTestEnv();
    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;
  });

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  async function uploadWithManifest(name: string, manifestExtra: Record<string, unknown>) {
    await initAndNew(projectDir, env, name);
    await fs.writeFile(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({ name, description: "", distDir: "dist", ...manifestExtra }),
    );
    await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "dist", "index.html"), "<h1>notify</h1>");
    return runCli(["upload", "./dist"], { cwd: projectDir, env: cliEnvVars(env) });
  }

  async function readUploadedMeta(name: string) {
    const metaPath = path.join(env.dataDir, env.userId, name, "meta.json");
    const content = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(content);
  }

  it("manifest 含 notify.enabled=true 时请求包含 notifyConfig，server 写入 meta.json.notify", async () => {
    const result = await uploadWithManifest("upload-notify-true", { notify: { enabled: true } });
    expect(result.exitCode).toBe(0);
    const meta = await readUploadedMeta("upload-notify-true");
    expect(meta.notify).toEqual({ enabled: true });
  });

  it("manifest 含完整 notify.permission 时正确序列化", async () => {
    const result = await uploadWithManifest("upload-notify-perm", {
      notify: { enabled: true, permission: { table: "users", userColumn: "id", where: "role='supervisor'" } },
    });
    expect(result.exitCode).toBe(0);
    const meta = await readUploadedMeta("upload-notify-perm");
    expect(meta.notify).toEqual({
      enabled: true,
      permission: { table: "users", userColumn: "id", where: "role='supervisor'" },
    });
  });

  it("manifest 不含 notify 字段时不发送 notifyConfig（meta.json 无 notify 字段）", async () => {
    const result = await uploadWithManifest("upload-notify-none", {});
    expect(result.exitCode).toBe(0);
    const meta = await readUploadedMeta("upload-notify-none");
    expect(meta.notify).toBeUndefined();
  });
});
