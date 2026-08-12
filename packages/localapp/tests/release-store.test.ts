import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";
import { publishRelease, readCurrentRelease, verifyReleaseArtifact } from "../src/daemon/release-store.js";
import { buildLocalAppPackage } from "../scripts/build-package.mjs";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7-release-tests");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("daemon runtime layout", () => {
  it("uses platform user roots and an injectable repository-local runtime", () => {
    const mac = createRuntimeLayout({ platform: "darwin", homeDir: "/Users/Alice", runtimeDir: "/repo/tmp/run", uid: 501 });
    expect(mac.supportDir).toBe("/Users/Alice/Library/Application Support/LocalApp");
    expect(mac.controlEndpoint).toBe("/repo/tmp/run/control.sock");

    const linux = createRuntimeLayout({
      platform: "linux",
      homeDir: "/home/alice",
      env: { XDG_DATA_HOME: "/data home", XDG_RUNTIME_DIR: "/run/user/1000" },
      uid: 1000,
    });
    expect(linux.supportDir).toBe("/data home/localapp");
    expect(linux.runtimeDir).toBe("/run/user/1000/localapp");

    const windows = createRuntimeLayout({
      platform: "win32",
      homeDir: "C:\\Users\\Alice",
      env: { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" },
    });
    expect(windows.supportDir).toBe("C:\\Users\\Alice\\AppData\\Local\\LocalApp");
    expect(windows.controlEndpoint).toMatch(/^\\\\\.\\pipe\\localapp-[0-9a-f]{24}$/);
  });
});

describe("release store", () => {
  it("publishes the real self-contained packed product manifest", async () => {
    const root = await fixtureRoot();
    const source = path.join(root, "real packed product");
    await buildLocalAppPackage({ outputDirectory: source });
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support"),
      runtimeDir: path.join(root, "runtime"),
    });

    const published = await publishRelease({ sourceDirectory: source, layout });

    expect(await verifyReleaseArtifact(published.releasePath)).toMatchObject({
      schemaVersion: 2,
      name: "localapp",
      entrypoint: "bin/localapp.mjs",
      bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs",
    });
    expect(await fs.readFile(layout.launcherPath, "utf8")).not.toContain(repositoryRoot);
  }, 30_000);

  it("verifies, atomically publishes, and idempotently reuses one immutable release", async () => {
    const root = await fixtureRoot();
    const source = await writeArtifact(path.join(root, "packed product"), "one");
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support with spaces"),
      runtimeDir: path.join(root, "runtime"),
    });

    const [first, second] = await Promise.all([
      publishRelease({ sourceDirectory: source, layout }),
      publishRelease({ sourceDirectory: source, layout }),
    ]);

    expect(second).toEqual(first);
    expect(path.basename(first.releasePath)).toBe(`0.1.0-${first.artifactDigest}`);
    expect(await readCurrentRelease(layout)).toEqual(first);
    expect(await fs.readFile(layout.launcherPath, "utf8")).toContain("current.json");
    expect(await verifyReleaseArtifact(first.releasePath)).toMatchObject({ artifactDigest: first.artifactDigest });
    if (process.platform !== "win32") {
      expect((await fs.stat(layout.releasesDir)).mode & 0o077).toBe(0);
      expect((await fs.stat(layout.currentManifestPath)).mode & 0o077).toBe(0);
    }
  });

  it("preserves the previous current release when a candidate is corrupt", async () => {
    const root = await fixtureRoot();
    const firstSource = await writeArtifact(path.join(root, "first"), "one");
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support"),
      runtimeDir: path.join(root, "runtime"),
    });
    const first = await publishRelease({ sourceDirectory: firstSource, layout });
    const corrupt = await writeArtifact(path.join(root, "corrupt"), "two");
    await fs.writeFile(path.join(corrupt, "bin/localapp.mjs"), "tampered\n");

    await expect(publishRelease({ sourceDirectory: corrupt, layout })).rejects.toMatchObject({ code: "release_artifact_invalid" });
    expect(await readCurrentRelease(layout)).toEqual(first);
  });

  it.skipIf(process.platform === "win32")("reclaims a dead publisher lock but fails closed for an active publisher", async () => {
    const root = await fixtureRoot();
    const source = await writeArtifact(path.join(root, "source"), "one");
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support"),
      runtimeDir: path.join(root, "runtime"),
    });
    await fs.mkdir(layout.runtimeDir, { recursive: true });
    const deadPid = await exitedProcessPid();
    await fs.writeFile(layout.releaseLockPath, `${JSON.stringify({ schemaVersion: 1, pid: deadPid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    await expect(publishRelease({ sourceDirectory: source, layout, lockTimeoutMs: 100 })).resolves.toMatchObject({ version: "0.1.0" });

    await fs.writeFile(layout.releaseLockPath, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    await expect(publishRelease({ sourceDirectory: source, layout, lockTimeoutMs: 50 }))
      .rejects.toMatchObject({ code: "release_store_busy" });
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked support root before writing outside it", async () => {
    const root = await fixtureRoot();
    const source = await writeArtifact(path.join(root, "source"), "one");
    const outside = path.join(root, "outside");
    const supportLink = path.join(root, "support-link");
    await fs.mkdir(outside);
    await fs.symlink(outside, supportLink);
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: supportLink,
      runtimeDir: path.join(root, "runtime"),
    });

    await expect(publishRelease({ sourceDirectory: source, layout, lockTimeoutMs: 100 }))
      .rejects.toMatchObject({ code: "release_path_unsafe" });
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("keeps the stable launcher immutable across current-release updates", async () => {
    const root = await fixtureRoot();
    const source = await writeArtifact(path.join(root, "source"), "one");
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support"),
      runtimeDir: path.join(root, "runtime"),
    });
    const first = await publishRelease({ sourceDirectory: source, layout });
    await fs.writeFile(layout.launcherPath, "incompatible launcher\n");

    await expect(publishRelease({ sourceDirectory: source, layout })).rejects.toMatchObject({ code: "release_launcher_incompatible" });
    expect(await readCurrentRelease(layout)).toEqual(first);
  });

  it.skipIf(process.platform === "win32")("stable bootstrap refuses a mutated published entrypoint", async () => {
    const root = await fixtureRoot();
    const source = path.join(root, "real source");
    await buildLocalAppPackage({ outputDirectory: source });
    const layout = createRuntimeLayout({
      platform: process.platform,
      homeDir: root,
      supportDir: path.join(root, "support"),
      runtimeDir: path.join(root, "runtime"),
    });
    const published = await publishRelease({ sourceDirectory: source, layout });
    const marker = path.join(root, "compromised-marker");
    await fs.writeFile(path.join(published.releasePath, "bin/localapp.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(process.env.LOCALAPP_BOOTSTRAP_MARKER, "executed");\n`);

    const result = await runNode(layout.launcherPath, { LOCALAPP_BOOTSTRAP_MARKER: marker });

    expect(result.code).not.toBe(0);
    await expect(fs.stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("rejects unlisted files and symbolic links rather than copying ambient credentials", async () => {
    const root = await fixtureRoot();
    const extra = await writeArtifact(path.join(root, "extra"), "one");
    await fs.writeFile(path.join(extra, "profiles.json"), '{"apiKey":"must-not-copy"}\n');
    await expect(verifyReleaseArtifact(extra)).rejects.toMatchObject({ code: "release_artifact_invalid" });

    if (process.platform !== "win32") {
      const linked = await writeArtifact(path.join(root, "linked"), "one");
      await fs.rm(path.join(linked, "bin/localapp.mjs"));
      await fs.symlink(path.join(linked, "package.json"), path.join(linked, "bin/localapp.mjs"));
      await expect(verifyReleaseArtifact(linked)).rejects.toMatchObject({ code: "release_artifact_invalid" });
    }
  });
});

async function fixtureRoot(): Promise<string> {
  await fs.mkdir(testRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
  directories.push(root);
  return root;
}

async function writeArtifact(directory: string, marker: string): Promise<string> {
  const values = new Map<string, string>([
    ["bin/localapp.mjs", `#!/usr/bin/env node\nconsole.log(${JSON.stringify(marker)});\n`],
    ["package.json", `${JSON.stringify({ name: "localapp", version: "0.1.0", bin: { localapp: "bin/localapp.mjs" } })}\n`],
    ["runtime/bootstrap/localapp-daemon-bootstrap.mjs", "// stable launcher reads current.json\n"],
  ]);
  for (const [relativePath, value] of values) {
    const target = path.join(directory, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, value);
  }
  const files = [...values].map(([relativePath, value]) => ({
    path: relativePath,
    size: Buffer.byteLength(value),
    sha256: crypto.createHash("sha256").update(value).digest("hex"),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const descriptor = {
    schemaVersion: 2,
    name: "localapp",
    version: "0.1.0",
    nodeMajor: 24,
    entrypoint: "bin/localapp.mjs",
    bootstrapEntrypoint: "runtime/bootstrap/localapp-daemon-bootstrap.mjs",
    files,
  } as const;
  const artifactDigest = crypto.createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
  await fs.writeFile(path.join(directory, ".localapp-artifact.json"), `${JSON.stringify({ ...descriptor, artifactDigest }, null, 2)}\n`);
  return directory;
}

function runNode(script: string, environment: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

function exitedProcessPid(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = child.pid;
    if (pid === undefined) return reject(new Error("fixture process has no PID"));
    child.once("error", reject);
    child.once("exit", () => resolve(pid));
  });
}
