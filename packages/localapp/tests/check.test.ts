import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { runLocalApp } from "../src/main.js";
import {
  checkProject,
  type ProjectCommandInvocation,
  type ProjectCommandRunner,
} from "../src/project/check.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-4-check-tests");
const directories: string[] = [];

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("project checks", () => {
  it("runs tests before build with the package manager selected by the project lockfile", async () => {
    // Break caught: choosing a workspace-global package manager or building before tests makes checks non-project-specific and can package untested output.
    const projectDir = await createProject({ lockfile: "pnpm-lock.yaml" });
    const invocations: ProjectCommandInvocation[] = [];
    const report = await checkProject({
      projectDir,
      run: successfulRunner(invocations),
    });

    expect(report.success).toBe(true);
    expect(invocations).toEqual([
      { command: "pnpm", args: ["run", "test"], cwd: projectDir, phase: "tests" },
      { command: "pnpm", args: ["run", "build"], cwd: projectDir, phase: "build" },
    ]);
    expect(report.phases).toEqual([
      { phase: "project", status: "passed" },
      { phase: "capabilities", status: "passed" },
      { phase: "migrations", status: "passed" },
      { phase: "backend", status: "passed" },
      { phase: "tests", status: "passed" },
      { phase: "build", status: "passed" },
      { phase: "dist", status: "passed" },
    ]);
  });

  it("stops after a failing test phase and leaves every later phase not-run", async () => {
    // Break caught: continuing after failed tests can build and package a stale dist directory.
    const projectDir = await createProject();
    const invocations: ProjectCommandInvocation[] = [];
    const run: ProjectCommandRunner = async (invocation) => {
      invocations.push(invocation);
      return { exitCode: invocation.phase === "tests" ? 17 : 0, stdout: "credential-in-child-output", stderr: "secret-in-child-error" };
    };

    const report = await checkProject({ projectDir, run });

    expect(report.success).toBe(false);
    expect(report.failedPhase).toBe("tests");
    expect(report.phases.find((phase) => phase.phase === "build")?.status).toBe("not-run");
    expect(report.phases.find((phase) => phase.phase === "dist")?.status).toBe("not-run");
    expect(invocations.map((invocation) => invocation.phase)).toEqual(["tests"]);
    expect(JSON.stringify(report)).not.toContain("credential-in-child-output");
    expect(JSON.stringify(report)).not.toContain("secret-in-child-error");
  });

  it("turns a package-manager launch error into a credential-safe failed report", async () => {
    // Break caught: a missing package-manager executable escaping checkProject makes check --json emit no machine-readable report.
    const projectDir = await createProject();
    const report = await checkProject({
      projectDir,
      run: async () => { throw new Error("spawn failed with reflected-credential"); },
    });

    expect(report).toMatchObject({ success: false, failedPhase: "tests" });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "APP_TEST_FAILED",
      message: "Could not run project test script",
    }));
    expect(JSON.stringify(report)).not.toContain("reflected-credential");
    expect(report.phases.find((phase) => phase.phase === "build")?.status).toBe("not-run");
  });

  it.each([
    { filename: "manifest.json", failedPhase: "project" },
    { filename: "package.json", failedPhase: "tests" },
  ])("rejects $filename when it is replaced by a symlink after validation", async ({ filename, failedPhase }) => {
    // Break caught: validating one inode and then reading a symlink target by pathname can import JSON from outside the project.
    const projectDir = await createProject();
    const outsideDir = await fs.mkdtemp(path.join(testRoot, "outside-"));
    directories.push(outsideDir);
    const target = path.join(projectDir, filename);
    const outside = path.join(outsideDir, filename);
    await fs.copyFile(target, outside);
    let replaced = false;

    const report = await checkProject({
      projectDir,
      run: successfulRunner([]),
      fileHooks: {
        beforeOpen: async (filePath: string) => {
          if (filePath !== target || replaced) return;
          replaced = true;
          await fs.rename(target, `${target}.original`);
          await fs.symlink(outside, target);
        },
      },
    });

    expect(replaced).toBe(true);
    expect(report.success).toBe(false);
    expect(report.failedPhase).toBe(failedPhase);
  });

  it.each([
    {
      name: "an invalid application name",
      mutate: (manifest: Record<string, unknown>) => { manifest.name = "API"; },
      phase: "project",
      code: "PROJECT_NAME_INVALID",
    },
    {
      name: "an invalid platform range",
      mutate: (manifest: Record<string, unknown>) => { manifest.platformVersion = "1.2.0"; },
      phase: "project",
      code: "PLATFORM_VERSION_INVALID",
    },
    {
      name: "an undeclared content capability",
      mutate: (manifest: Record<string, unknown>) => {
        manifest.requires = { content: { mimeTypes: ["video/mp4"] }, backend: "named-sql", identity: [], primitives: [] };
      },
      phase: "capabilities",
      code: "CAPABILITY_CONTENT_TYPE_UNSUPPORTED",
    },
  ])("rejects $name before running project scripts", async ({ mutate, phase, code }) => {
    // Break caught: accepting malformed identity/platform/capability declarations lets an incompatible application reach packaging.
    const projectDir = await createProject({ mutateManifest: mutate });
    const invocations: ProjectCommandInvocation[] = [];

    const report = await checkProject({ projectDir, run: successfulRunner(invocations) });

    expect(report.success).toBe(false);
    expect(report.failedPhase).toBe(phase);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error", phase }));
    expect(invocations).toEqual([]);
    expect(report.phases.find((item) => item.phase === "tests")?.status).toBe("not-run");
  });

  it("uses server-core migration filename validation", async () => {
    // Break caught: a CLI-specific migration parser can accept filenames the Server later rejects.
    const projectDir = await createProject();
    await fs.rename(path.join(projectDir, "migrations/001_items.sql"), path.join(projectDir, "migrations/items.sql"));

    const report = await checkProject({ projectDir, run: successfulRunner([]) });

    expect(report.failedPhase).toBe("migrations");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "MIGRATION_VALIDATION_FAILED",
      message: expect.stringContaining("Invalid migration filename: items.sql"),
    }));
  });

  it("uses the server-core Named SQL backend contract validator", async () => {
    // Break caught: superficial JSON checks can package Named SQL with undeclared parameters that the Server cannot execute.
    const projectDir = await createProject();
    const manifest = JSON.parse(await fs.readFile(path.join(projectDir, "manifest.json"), "utf8"));
    manifest.platformVersion = "^1.0";
    await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.writeFile(path.join(projectDir, "backend/resources/items/queries.json"), `${JSON.stringify({
      $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
      queries: { "items.byId": { sql: "SELECT * FROM items WHERE id = :id" } },
    })}\n`);

    const report = await checkProject({ projectDir, run: successfulRunner([]) });

    expect(report.failedPhase).toBe("backend");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "BACKEND_CONTRACT_INVALID",
      message: expect.stringContaining("Missing declarations: id"),
    }));
  });

  it("requires the configured dist index after a successful build", async () => {
    // Break caught: reporting a green build without its browser entrypoint creates an uninstallable package.
    const projectDir = await createProject();
    await fs.rm(path.join(projectDir, "dist/index.html"));

    const report = await checkProject({ projectDir, run: successfulRunner([]) });

    expect(report.failedPhase).toBe("dist");
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "DIST_INVALID" }));
  });

  it("prints one machine-readable report and returns nonzero for check --json failure", async () => {
    // Break caught: wrapping a failed JSON check in a second generic error makes stdout/stderr impossible for automation to parse safely.
    const projectDir = await createProject({ mutateManifest: (manifest) => { manifest.name = "invalid--name"; } });
    let stdout = "";
    let stderr = "";

    const code = await withCwd(projectDir, () => runLocalApp(["check", "--json"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    }));

    expect(code).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ success: false, failedPhase: "project" });
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });
});

interface ProjectFixtureOptions {
  lockfile?: string;
  mutateManifest?: (manifest: Record<string, unknown>) => void;
}

async function createProject(options: ProjectFixtureOptions = {}): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(testRoot, "case-"));
  directories.push(projectDir);
  const manifest: Record<string, unknown> = {
    name: "items-app",
    description: "Items",
    distDir: "dist",
    db: { mode: "crud", sqlAccess: "authenticated" },
    backend: { root: "backend" },
    requires: {
      content: { mimeTypes: ["application/pdf"], maxBytes: 1_000_000, inlinePreview: ["application/pdf"] },
      backend: "named-sql",
      identity: ["currentUser", "pageOwner"],
      primitives: [],
    },
    platformVersion: "^1.2",
  };
  options.mutateManifest?.(manifest);
  await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "migrations"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "backend/resources/items"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({
    name: "fixture-project",
    version: "1.4.2",
    scripts: { test: "fixture-test", build: "fixture-build" },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, options.lockfile ?? "package-lock.json"), "{}\n");
  await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>items</main>\n");
  await fs.writeFile(path.join(projectDir, "migrations/001_items.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);\n");
  await fs.writeFile(path.join(projectDir, "backend/resources/items/schema.json"), `${JSON.stringify({
    $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
    name: "items",
    fields: { id: { type: "string" } },
  })}\n`);
  await fs.writeFile(path.join(projectDir, "backend/resources/items/queries.json"), `${JSON.stringify({
    $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
    queries: {},
  })}\n`);
  await fs.writeFile(path.join(projectDir, "backend/resources/items/mutations.json"), `${JSON.stringify({
    $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
    mutations: {},
  })}\n`);
  return projectDir;
}

function successfulRunner(invocations: ProjectCommandInvocation[]): ProjectCommandRunner {
  return async (invocation) => {
    invocations.push(invocation);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

async function withCwd<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const original = process.cwd();
  process.chdir(directory);
  try {
    return await action();
  } finally {
    process.chdir(original);
  }
}
