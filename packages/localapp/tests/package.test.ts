import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { inspectAppPackage } from "../../server/src/lib/app-package.js";
import { runLocalApp } from "../src/main.js";
import type { ProjectCommandInvocation, ProjectCommandRunner } from "../src/project/check.js";
import { buildApplicationPackage } from "../src/project/package.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-4-package-tests");
const directories: string[] = [];

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("application package creation", () => {
  it("builds byte-identical canonical packages accepted by the real Server inspector", async () => {
    // Break caught: local archive code, unstable ordering, or variable timestamps makes packages incompatible or non-reproducible.
    const projectDir = await createProject({ customRoots: true });
    const first = await buildApplicationPackage({
      projectDir,
      outputPath: path.join(projectDir, "a.localapp"),
      run: successfulRunner([]),
    });
    const second = await buildApplicationPackage({
      projectDir,
      outputPath: path.join(projectDir, "b.localapp"),
      run: successfulRunner([]),
    });

    expect(first.sha256).toBe(second.sha256);
    expect(await fs.readFile(first.path)).toEqual(await fs.readFile(second.path));
    expect(first).toMatchObject({ appId: "items-app", version: "2.3.4" });
    expect(first.size).toBeGreaterThan(0);
    const inspected = await inspectAppPackage(first.path);
    expect(inspected.digest).toBe(first.sha256);
    expect(inspected.entries.map((entry) => entry.path)).toEqual([
      "backend/resources/items/mutations.json",
      "backend/resources/items/queries.json",
      "backend/resources/items/schema.json",
      "dist/assets/app.js",
      "dist/index.html",
      "manifest.json",
      "migrations/001_items.sql",
    ]);
    expect(inspected.manifest).toMatchObject({
      name: "items-app",
      distDir: "dist",
      backend: { root: "backend" },
    });
    expect((inspected.manifest.backend as Record<string, unknown>).include).toBeUndefined();
  });

  it("defaults the application version to 0.0.0 when package.json has no usable version", async () => {
    // Break caught: borrowing the CLI package version makes unrelated applications share an accidental release identity.
    const projectDir = await createProject();
    await fs.writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({ scripts: { test: "fixture-test", build: "fixture-build" } })}\n`);

    const built = await buildApplicationPackage({
      projectDir,
      outputPath: path.join(projectDir, "default.localapp"),
      run: successfulRunner([]),
    });

    expect(built.version).toBe("0.0.0");
    expect((await inspectAppPackage(built.path)).metadata.version).toBe("0.0.0");
  });

  it("never writes a package after failed tests even when stale dist exists", async () => {
    // Break caught: collecting a pre-existing dist after failed tests publishes stale application code.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "stale.localapp");
    const invocations: ProjectCommandInvocation[] = [];
    const run: ProjectCommandRunner = async (invocation) => {
      invocations.push(invocation);
      return { exitCode: invocation.phase === "tests" ? 1 : 0, stdout: "", stderr: "" };
    };

    await expect(buildApplicationPackage({ projectDir, outputPath, run })).rejects.toMatchObject({ code: "project_check_failed" });
    await expect(fs.access(outputPath)).rejects.toThrow();
    expect(invocations.map((invocation) => invocation.phase)).toEqual(["tests"]);
  });

  it("rejects symlinked package sources before archive creation", async () => {
    // Break caught: following a symlink can exfiltrate files outside the project into the application package.
    const projectDir = await createProject();
    const outside = path.join(projectDir, "outside.txt");
    await fs.writeFile(outside, "outside\n");
    await fs.symlink(outside, path.join(projectDir, "dist/leak.txt"));
    const outputPath = path.join(projectDir, "unsafe.localapp");

    await expect(buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) })).rejects.toThrow(/symlink/i);
    await expect(fs.access(outputPath)).rejects.toThrow();
  });

  it("rejects a dist file replaced by a symlink after its lstat", async () => {
    // Break caught: collectTree reading by pathname after lstat can package bytes from outside the project.
    const projectDir = await createProject();
    const outsideDir = await fs.mkdtemp(path.join(testRoot, "outside-"));
    directories.push(outsideDir);
    const target = path.join(projectDir, "dist/index.html");
    const outside = path.join(outsideDir, "outside.html");
    const outputPath = path.join(projectDir, "raced.localapp");
    await fs.writeFile(outside, "<main>outside secret</main>\n");
    let replaced = false;

    await expect(buildApplicationPackage({
      projectDir,
      outputPath,
      run: successfulRunner([]),
      fileHooks: {
        beforeOpen: async (filePath: string) => {
          if (filePath !== target || replaced) return;
          replaced = true;
          await fs.rename(target, `${target}.original`);
          await fs.symlink(outside, target);
        },
      },
    })).rejects.toBeTruthy();

    expect(replaced).toBe(true);
    await expect(fs.access(outputPath)).rejects.toThrow();
  });

  it("rejects outside content reached by replacing a checked dist ancestor", async () => {
    // Break caught: checking ancestors only by pathname lets a replacement directory redirect both leaf lstat and open outside the project.
    const projectDir = await createProject();
    const outsideDir = await fs.mkdtemp(path.join(testRoot, "outside-"));
    directories.push(outsideDir);
    const distDir = path.join(projectDir, "dist");
    const target = path.join(distDir, "index.html");
    const outsideDist = path.join(outsideDir, "dist");
    const outputPath = path.join(projectDir, "ancestor-raced.localapp");
    await fs.mkdir(path.join(outsideDist, "assets"), { recursive: true });
    await fs.writeFile(path.join(outsideDist, "index.html"), "<main>outside secret</main>\n");
    await fs.writeFile(path.join(outsideDist, "assets/app.js"), "console.log('outside secret');\n");
    let replaced = false;

    await expect(buildApplicationPackage({
      projectDir,
      outputPath,
      run: successfulRunner([]),
      fileHooks: {
        afterAncestorValidation: async (filePath: string) => {
          if (filePath !== target || replaced) return;
          replaced = true;
          await fs.rename(distDir, `${distDir}.original`);
          await fs.symlink(outsideDist, distDir);
        },
      },
    })).rejects.toMatchObject({ code: "project_check_failed" });

    expect(replaced).toBe(true);
    await expect(fs.access(outputPath)).rejects.toThrow();
  });

  it("revalidates an output parent after project scripts replace it with a symlink", async () => {
    // Break caught: validating the output parent before build scripts lets package creation escape through a replacement symlink.
    const projectDir = await createProject();
    const outsideDir = await fs.mkdtemp(path.join(testRoot, "outside-"));
    directories.push(outsideDir);
    const outputParent = path.join(projectDir, "package-output");
    const outputPath = path.join(outputParent, "items.localapp");
    await fs.mkdir(outputParent);
    let replaced = false;
    const run: ProjectCommandRunner = async (invocation) => {
      if (invocation.phase === "build" && !replaced) {
        replaced = true;
        await fs.rm(outputParent, { recursive: true });
        await fs.symlink(outsideDir, outputParent);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await expect(buildApplicationPackage({ projectDir, outputPath, run })).rejects.toMatchObject({ code: "unsafe_project_path" });
    expect(replaced).toBe(true);
    expect(await fs.readdir(outsideDir)).toEqual([]);
  });

  it("does not create candidate files through an output parent replaced after preparation", async () => {
    // Break caught: creating the sibling candidate by absolute pathname after validation can write package bytes outside the intended parent.
    const projectDir = await createProject();
    const outsideDir = await fs.mkdtemp(path.join(testRoot, "outside-"));
    directories.push(outsideDir);
    const outputParent = path.join(projectDir, "package-output");
    const outputPath = path.join(outputParent, "items.localapp");
    await fs.mkdir(outputParent);
    let replaced = false;

    await expect(buildApplicationPackage({
      projectDir,
      outputPath,
      run: successfulRunner([]),
      outputHooks: {
        beforeCandidateCreate: async () => {
          replaced = true;
          await fs.rename(outputParent, `${outputParent}.original`);
          await fs.symlink(outsideDir, outputParent);
        },
      },
    })).rejects.toMatchObject({ code: "unsafe_project_path" });

    expect(replaced).toBe(true);
    expect(await fs.readdir(outsideDir)).toEqual([]);
    await expect(fs.access(outputPath)).rejects.toThrow();
  });

  it("preserves an output created concurrently by a project build script", async () => {
    // Break caught: a failed wx write must not delete a file that appeared after initial output validation.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "concurrent.localapp");
    const sentinel = Buffer.from("concurrent owner data\n");
    let created = false;
    const run: ProjectCommandRunner = async (invocation) => {
      if (invocation.phase === "build" && !created) {
        created = true;
        await fs.writeFile(outputPath, sentinel);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await expect(buildApplicationPackage({ projectDir, outputPath, run })).rejects.toMatchObject({ code: "package_output_exists" });
    expect(created).toBe(true);
    expect(await fs.readFile(outputPath)).toEqual(sentinel);
  });

  it("keeps the previous package when inspection of an overwrite candidate fails", async () => {
    // Break caught: deleting the old artifact before candidate inspection turns a transient failure into data loss.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "existing.localapp");
    await buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) });
    const previous = await fs.readFile(outputPath);
    await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>new candidate</main>\n");

    await expect(buildApplicationPackage({
      projectDir,
      outputPath,
      overwrite: true,
      run: successfulRunner([]),
      packageOperations: {
        inspectPackage: async () => { throw new Error("injected inspection failure"); },
      },
    })).rejects.toThrow("injected inspection failure");

    expect(await fs.readFile(outputPath)).toEqual(previous);
    expect((await fs.readdir(projectDir)).filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it.each([
    { overwrite: false, label: "no-overwrite" },
    { overwrite: true, label: "overwrite" },
  ])("publishes the inspected candidate after $label pathname substitution", async ({ overwrite }) => {
    // Break caught: publishing whichever inode occupies the inspected temporary pathname can report one digest while installing different bytes.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "substitution.localapp");
    if (overwrite) {
      await buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) });
      await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>new inspected candidate</main>\n");
    }
    const replacement = Buffer.from("attacker replacement bytes\n");
    let inspectedBytes: Buffer | undefined;

    const built = await buildApplicationPackage({
      projectDir,
      outputPath,
      overwrite,
      run: successfulRunner([]),
      packageOperations: {
        inspectPackage: async (candidatePath) => {
          const inspected = await inspectAppPackage(candidatePath);
          inspectedBytes = await fs.readFile(candidatePath);
          await fs.rename(candidatePath, `${candidatePath}.inspected`);
          await fs.writeFile(candidatePath, replacement);
          return inspected;
        },
      },
    });

    expect(inspectedBytes).toBeDefined();
    expect(await fs.readFile(outputPath)).toEqual(inspectedBytes);
    expect(await fs.readFile(outputPath)).not.toEqual(replacement);
    expect(built).toMatchObject({ appId: "items-app", version: "2.3.4" });
    expect(built.sha256).toBe(crypto.createHash("sha256").update(inspectedBytes!).digest("hex"));
  });

  it.each([
    { overwrite: false, label: "no-overwrite" },
    { overwrite: true, label: "overwrite" },
  ])("never publishes an exact pinned candidate inode mutated after $label inspection", async ({ overwrite }) => {
    // Break caught: hashing only before rematerialization can publish post-inspection mutations with the inspector's original digest.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "inode-mutation.localapp");
    let previousBuild: Awaited<ReturnType<typeof buildApplicationPackage>> | undefined;
    let previousBytes: Buffer | undefined;
    if (overwrite) {
      previousBuild = await buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) });
      previousBytes = await fs.readFile(outputPath);
      await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>new inspected candidate</main>\n");
    }
    const attackerBytes = Buffer.from("attacker-mutated pinned inode bytes\n");
    let candidatePathSeen: string | undefined;
    let mutatedExactInode = false;
    let built: Awaited<ReturnType<typeof buildApplicationPackage>> | undefined;
    let failure: unknown;

    try {
      built = await buildApplicationPackage({
        projectDir,
        outputPath,
        overwrite,
        run: successfulRunner([]),
        packageOperations: {
          inspectPackage: async (candidatePath) => {
            candidatePathSeen = candidatePath;
            const pinned = await fs.open(candidatePath, "r+");
            try {
              const before = await pinned.stat({ bigint: true });
              const inspected = await inspectAppPackage(candidatePath);
              await pinned.truncate(0);
              await pinned.writeFile(attackerBytes);
              await pinned.sync();
              const after = await pinned.stat({ bigint: true });
              mutatedExactInode = before.dev === after.dev && before.ino === after.ino;
              return inspected;
            } finally {
              await pinned.close();
            }
          },
        },
      });
    } catch (error) {
      failure = error;
    }

    const published = await fs.readFile(outputPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    expect(candidatePathSeen).toBeDefined();
    expect(candidatePathSeen).not.toBe(outputPath);
    expect(mutatedExactInode).toBe(true);
    expect(published).not.toEqual(attackerBytes);
    if (built !== undefined) {
      expect(failure).toBeUndefined();
      expect(published).toBeDefined();
      expect(crypto.createHash("sha256").update(published!).digest("hex")).toBe(built.sha256);
    } else {
      expect(failure).toBeDefined();
      if (overwrite) {
        expect(published).toEqual(previousBytes);
        expect(crypto.createHash("sha256").update(published!).digest("hex")).toBe(previousBuild!.sha256);
      } else {
        expect(published).toBeUndefined();
      }
    }
  });

  it("requires a safe .localapp output and overwrites only when explicitly requested", async () => {
    // Break caught: implicit replacement or symlink-following can destroy an unrelated output file.
    const projectDir = await createProject();
    const outputPath = path.join(projectDir, "items.localapp");
    await buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) });

    await expect(buildApplicationPackage({ projectDir, outputPath, run: successfulRunner([]) })).rejects.toMatchObject({ code: "package_output_exists" });
    await expect(buildApplicationPackage({
      projectDir,
      outputPath,
      overwrite: true,
      run: successfulRunner([]),
    })).resolves.toMatchObject({ path: outputPath });
    await expect(buildApplicationPackage({
      projectDir,
      outputPath: path.join(projectDir, "wrong.zip"),
      run: successfulRunner([]),
    })).rejects.toMatchObject({ code: "invalid_package_output" });

    const realDirectory = path.join(projectDir, "real-output");
    const linkedDirectory = path.join(projectDir, "linked-output");
    await fs.mkdir(realDirectory);
    await fs.symlink(realDirectory, linkedDirectory);
    await expect(buildApplicationPackage({
      projectDir,
      outputPath: path.join(linkedDirectory, "linked.localapp"),
      run: successfulRunner([]),
    })).rejects.toMatchObject({ code: "unsafe_project_path" });
  });

  it("prints a structured build --package result without child-process output", async () => {
    // Break caught: forwarding build logs or an ad-hoc message makes the packaged CLI response unsafe for automation.
    const projectDir = await createProject({ realScripts: true });
    let stdout = "";
    let stderr = "";

    const code = await withCwd(projectDir, () => runLocalApp(["build", "--package", "--output", "cli.localapp"], {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    }));

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({
      success: true,
      appId: "items-app",
      version: "2.3.4",
      path: path.join(projectDir, "cli.localapp"),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      size: expect.any(Number),
    });
    expect(stdout.trim().split("\n")).toHaveLength(1);
  });
});

interface ProjectFixtureOptions {
  customRoots?: boolean;
  realScripts?: boolean;
}

async function createProject(options: ProjectFixtureOptions = {}): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(testRoot, "case-"));
  directories.push(projectDir);
  const distDir = options.customRoots ? "web-output" : "dist";
  const backendRoot = options.customRoots ? "contracts" : "backend";
  await fs.mkdir(path.join(projectDir, distDir, "assets"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "migrations"), { recursive: true });
  await fs.mkdir(path.join(projectDir, backendRoot, "resources/items"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify({
    name: "items-app",
    description: "Items",
    distDir,
    backend: { root: backendRoot },
    requires: { backend: "named-sql", identity: ["currentUser", "pageOwner"], primitives: [] },
    platformVersion: "^1.2",
  }, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({
    name: "items-fixture",
    version: "2.3.4",
    scripts: options.realScripts
      ? { test: "node -e \"process.exit(0)\"", build: "node -e \"process.exit(0)\"" }
      : { test: "fixture-test", build: "fixture-build" },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, "package-lock.json"), "{}\n");
  await fs.writeFile(path.join(projectDir, distDir, "index.html"), "<main>items</main>\n");
  await fs.writeFile(path.join(projectDir, distDir, "assets/app.js"), "console.log('items');\n");
  await fs.writeFile(path.join(projectDir, "migrations/001_items.sql"), "CREATE TABLE items (id TEXT PRIMARY KEY);\n");
  for (const [name, value] of Object.entries({
    "schema.json": {
      $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
      name: "items",
      fields: { id: { type: "string" } },
    },
    "queries.json": { $schema: "https://localapp.dev/schemas/backend/queries.schema.json", queries: {} },
    "mutations.json": { $schema: "https://localapp.dev/schemas/backend/mutations.schema.json", mutations: {} },
  })) {
    await fs.writeFile(path.join(projectDir, backendRoot, "resources/items", name), `${JSON.stringify(value)}\n`);
  }
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
