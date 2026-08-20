import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeProject } from "../src/commands/init.js";
import { stageBuiltinTemplate } from "../src/template/stage.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-3-init-tests");
const version = "0.1.0-test";
let directory = "";
let templateDirectory = "";

beforeEach(async () => {
  await fs.mkdir(testRoot, { recursive: true });
  directory = await fs.mkdtemp(path.join(testRoot, "case-"));
  templateDirectory = path.join(directory, "packed-template");
  await stageBuiltinTemplate({ repositoryRoot, outputDirectory: templateDirectory, version });
  vi.stubEnv("LOCALAPP_TEMPLATE_DIR", templateDirectory);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe("builtin project initialization", () => {
  it("initializes a complete builtin project from the staged package template", async () => {
    // Break caught: resolving a template only from the monorepo leaves installed packages unable to create a project.
    const io = { stdout: vi.fn(), stderr: vi.fn() };
    const result = await initializeProject({
      cwd: directory,
      name: "fresh-app",
      description: "Fresh application",
      skipInstall: true,
      skipDeploy: true,
      io,
    });
    const project = path.join(directory, "fresh-app");

    expect(result.projectDir).toBe(project);
    expect(JSON.parse(await fs.readFile(path.join(project, "manifest.json"), "utf8"))).toMatchObject({
      name: "fresh-app",
      description: "Fresh application",
      distDir: "dist",
    });
    expect(await exists(path.join(project, ".localapp/runtime/server-core/dist/index.js"))).toBe(true);
    expect(await exists(path.join(project, ".claude/skills/localapp/SKILL.md"))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(project, ".localapp/runtime/version.json"), "utf8"))).toEqual({ cliVersion: version });
    const packageJson = JSON.parse(await fs.readFile(path.join(project, "package.json"), "utf8"));
    expect(packageJson.dependencies["@localapp/server-core"]).toBe("file:./.localapp/runtime/server-core");
    expect(packageJson.dependencies["@localapp/sdk"]).toBe("file:./.localapp/runtime/sdk/core");
    expect(packageJson.optionalDependencies["@localapp/crdt"]).toBe("file:./.localapp/runtime/sdk/crdt");
    expect(await exists(path.join(project, ".localapp/runtime/sdk/crdt/src/index.ts"))).toBe(true);
    expect(await exists(path.join(project, ".claude/skills/localapp-collaboration/SKILL.md"))).toBe(true);
    expect(packageJson.scripts.postinstall).toBe("node .localapp/runtime/sync-template.cjs");
    expect(await exists(path.join(project, ".localapp/runtime/sync-template.cjs"))).toBe(true);
    expect(await fs.readFile(path.join(project, ".npmrc"), "utf8")).toContain("public-hoist-pattern[]=pdfjs-dist");
    expect(JSON.stringify(packageJson)).not.toContain("workspace:");
  });

  it("creates a project by default and leaves publication to app install", async () => {
    const io = { stdout: vi.fn(), stderr: vi.fn() };
    const result = await initializeProject({
      cwd: directory,
      name: "remote-app",
      skipInstall: true,
      skipDeploy: false,
      io,
    });
    expect(result.projectDir).toBe(path.join(directory, "remote-app"));
    expect(await exists(path.join(directory, "remote-app", "manifest.json"))).toBe(true);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining("localapp app install"));
  });
});

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}
