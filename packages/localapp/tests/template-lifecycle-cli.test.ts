import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeProject } from "../src/commands/init.js";
import { runLocalApp } from "../src/main.js";
import { stageBuiltinTemplate } from "../src/template/stage.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-3-lifecycle-cli-tests");
let directory = "";
let project = "";

beforeEach(async () => {
  await fs.mkdir(testRoot, { recursive: true });
  directory = await fs.mkdtemp(path.join(testRoot, "case-"));
  const templateDirectory = path.join(directory, "packed-template");
  await stageBuiltinTemplate({ repositoryRoot, outputDirectory: templateDirectory, version: "0.1.0-test" });
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

describe("template lifecycle CLI errors", () => {
  it("reports a non-project sync with an actionable typed error", async () => {
    // Break caught: local validation failures collapse into an unactionable command_failed envelope.
    const arbitraryDirectory = path.join(directory, "not-a-project");
    await fs.mkdir(arbitraryDirectory);

    const result = await runIn(arbitraryDirectory, ["sync-template", "--quiet"]);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: '{"error":{"code":"not_localapp_project","message":"This directory is not a LocalApp project. Run the command from a project created by localapp init."}}\n',
    });
  });

  it("reports ejected and collision states without exposing arbitrary exceptions", async () => {
    // Break caught: expected local eject states are hidden behind command_failed while raw errors would risk credential disclosure.
    await fs.writeFile(path.join(project, ".localapp/project-config.json"), '{"ejected":true,"templateState":"ejected"}\n');
    const ejected = await runIn(project, ["sync-template", "--quiet"]);
    expect(ejected.stderr).toBe('{"error":{"code":"template_ejected","message":"This project has been ejected. Managed template sync is permanently disabled."}}\n');

    await fs.writeFile(path.join(project, ".localapp/project-config.json"), '{}\n');
    await fs.mkdir(path.join(project, "src/_localapp_runtime"));
    const collision = await runIn(project, ["eject-template"]);
    expect(collision.stderr).toBe('{"error":{"code":"template_eject_collision","message":"Eject destination already exists: src/_localapp_runtime. Move or remove it before retrying."}}\n');
  });

  it("reports unavailable non-skipDeploy init before creating a directory", async () => {
    // Break caught: Task 4 deployment deferral is reported as a generic command failure instead of a safe next action.
    const result = await runIn(directory, ["init", "remote-app", "--skip-install"]);

    expect(result.stderr).toBe('{"error":{"code":"deployment_unavailable","message":"Project deployment is not available yet. Re-run with --skip-deploy."}}\n');
    await expect(fs.access(path.join(directory, "remote-app"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function runIn(cwd: string, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  let stdout = "";
  let stderr = "";
  const code = await runLocalApp(argv, {
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
  });
  vi.mocked(process.cwd).mockRestore();
  return { code, stdout, stderr };
}
