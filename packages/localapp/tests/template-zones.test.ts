import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejectManagedTemplate } from "../src/commands/eject-template.js";
import { initializeProject } from "../src/commands/init.js";
import { syncManagedTemplate } from "../src/commands/sync-template.js";
import { stageBuiltinTemplate } from "../src/template/stage.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-3-template-zone-tests");
const version = "0.1.0-test";
let directory = "";
let project = "";

beforeEach(async () => {
  await fs.mkdir(testRoot, { recursive: true });
  directory = await fs.mkdtemp(path.join(testRoot, "case-"));
  const templateDirectory = path.join(directory, "packed-template");
  await stageBuiltinTemplate({ repositoryRoot, outputDirectory: templateDirectory, version });
  vi.stubEnv("LOCALAPP_TEMPLATE_DIR", templateDirectory);
  project = (await initializeProject({
    cwd: directory,
    name: "fresh-app",
    skipInstall: true,
    skipDeploy: true,
    io: { stdout: () => undefined, stderr: () => undefined },
  })).projectDir;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe("managed template zones", () => {
  it("sync replaces managed files without changing user source", async () => {
    // Break caught: copying the full template during sync overwrites application source or custom skills.
    await fs.writeFile(path.join(project, "src/App.tsx"), "user-owned\n");
    await fs.writeFile(path.join(project, ".localapp/runtime/version.json"), '{"cliVersion":"stale"}\n');
    await fs.writeFile(path.join(project, ".claude/skills/localapp/SKILL.md"), "stale managed skill\n");
    await fs.mkdir(path.join(project, ".claude/skills/custom-user"), { recursive: true });
    await fs.writeFile(path.join(project, ".claude/skills/custom-user/SKILL.md"), "user-owned skill\n");

    const result = await syncManagedTemplate(project, { quiet: true });

    expect(result.updated).toBe(true);
    expect(await fs.readFile(path.join(project, "src/App.tsx"), "utf8")).toBe("user-owned\n");
    expect(await fs.readFile(path.join(project, ".claude/skills/custom-user/SKILL.md"), "utf8")).toBe("user-owned skill\n");
    expect(await fs.readFile(path.join(project, ".claude/skills/localapp/SKILL.md"), "utf8")).not.toBe("stale managed skill\n");
    expect(JSON.parse(await fs.readFile(path.join(project, ".localapp/runtime/version.json"), "utf8"))).toEqual({ cliVersion: version });
  });

  it("eject copies managed files into user ownership and permanently refuses later sync", async () => {
    // Break caught: ejecting without a durable marker lets a later automatic sync overwrite the newly user-owned runtime.
    const result = await ejectManagedTemplate(project);

    expect(result.ejected).toBe(true);
    expect(await exists(path.join(project, "src/_localapp_runtime/server-core/dist/index.js"))).toBe(true);
    expect(await exists(path.join(project, ".claude/skills/custom-localapp/SKILL.md"))).toBe(true);
    expect(JSON.parse(await fs.readFile(path.join(project, ".localapp/project-config.json"), "utf8"))).toMatchObject({ ejected: true });
    await expect(syncManagedTemplate(project, { quiet: true })).rejects.toThrow("ejected");
  });
});

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}
