import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars, createTemplateRepo } from "./helpers.js";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

describe("cli-init", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;
  let templateRepo: Awaited<ReturnType<typeof createTemplateRepo>>;

  beforeAll(async () => {
    env = await createCliTestEnv();

    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;

    templateRepo = await createTemplateRepo();
  });

  afterAll(async () => {
    await projectCleanup();
    await templateRepo.cleanup();
    await env.cleanup();
  });

  it("should initialize a complete local project without using the remote template", async () => {
    // Local-only init must not depend on the configured platform template.
    env.app.config.templateRepoUrl = templateRepo.repoDir.replace(/\\/g, "/");

    const result = await runCli(["init", "--name", "my-app", "--skip-deploy", "--skip-install"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.created).toBe("my-app");

    // Check directory was created
    const appDir = path.join(projectDir, "my-app");
    const stat = await fs.stat(appDir);
    expect(stat.isDirectory()).toBe(true);

    // Check manifest.json was written
    const manifest = JSON.parse(await fs.readFile(path.join(appDir, "manifest.json"), "utf-8"));
    expect(manifest.name).toBe("my-app");
    expect(manifest.distDir).toBe("dist");
    expect(manifest.platformVersion).toBe("^1.2");
    expect(manifest.requires).toEqual({
      backend: "named-sql",
      identity: ["currentUser", "pageOwner"],
      primitives: [],
    });

    // Check .localapp/dev-config.json was written
    const devConfigPath = path.join(appDir, ".localapp", "dev-config.json");
    expect(fsSync.existsSync(devConfigPath)).toBe(true);
    const devConfig = JSON.parse(fsSync.readFileSync(devConfigPath, "utf-8"));
    expect(devConfig.serverUrl).toBeDefined();
    expect(typeof devConfig.serverUrl).toBe("string");
    expect(devConfig.serverUrl.length).toBeGreaterThan(0);

    // Check template files exist
    expect(fsSync.existsSync(path.join(appDir, "package.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(appDir, "src", "main.tsx"))).toBe(true);

    expect(fsSync.existsSync(path.join(appDir, ".localapp", "runtime"))).toBe(true);
    const skill = await fs.readFile(
      path.join(appDir, ".claude", "skills", "localapp", "SKILL.md"),
      "utf-8",
    );
    expect(skill).toContain("localapp build --package");
    expect(skill).toContain("localapp local install");
    expect(skill).toContain("localapp upload --profile company --verify");
    expect(skill).toContain("verification.status=pending-browser");
  });

  it("should reject invalid name", async () => {
    const result = await runCli(["init", "--name", "XX", "--skip-deploy"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("Invalid name");
  });

  it("should reject when directory already exists", async () => {
    const result = await runCli(["init", "--name", "my-app", "--skip-deploy"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("already exists");
  });

  it("should use built-in template when repo URL is empty", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    env.app.config.templateRepoUrl = "";

    const result = await runCli(["init", "--name", "builtin-app", "--skip-deploy", "--skip-install"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.created).toBe("builtin-app");

    // Verify built-in template files exist
    const appDir = path.join(dir, "builtin-app");
    expect(fsSync.existsSync(path.join(appDir, "package.json"))).toBe(true);

    env.app.config.templateRepoUrl = templateRepo.repoDir.replace(/\\/g, "/");
    await cleanup();
  }, 15_000);

  it("should initialize the current empty directory when cwd name matches app name", async () => {
    const { dir: parentDir, cleanup } = await createTmpProjectDir();
    const appDir = path.join(parentDir, "same-name");
    await fs.mkdir(appDir);

    const result = await runCli(["init", "--name", "same-name", "--skip-deploy", "--skip-install", "--builtin-repo"], {
      cwd: appDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    expect(fsSync.existsSync(path.join(appDir, "manifest.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(appDir, "same-name"))).toBe(false);

    await cleanup();
  }, 15_000);

  it("should fall back to built-in template when git clone fails", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    env.app.config.templateRepoUrl = "file:///nonexistent/repo/path.git";

    const result = await runCli(["init", "--name", "fallback-app", "--skip-deploy", "--skip-install"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    // CLI falls back to built-in template on clone failure
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.created).toBe("fallback-app");

    // Verify built-in template files exist (fallback)
    const appDir = path.join(dir, "fallback-app");
    expect(fsSync.existsSync(path.join(appDir, "package.json"))).toBe(true);

    env.app.config.templateRepoUrl = templateRepo.repoDir.replace(/\\/g, "/");
    await cleanup();
  }, 15_000);
});
