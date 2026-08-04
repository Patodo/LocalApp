// Kept outside Vitest's default pattern because this suite uses node:test directly.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import {
  prepareNodeRuntime,
  publishPreparedRuntime,
  resolveRuntimeTarget,
  tauriBinaryName,
} from "./prepare-node-runtime.mjs";
import { runTauri } from "./run-tauri.mjs";

const VERSION = "24.18.0";

test("resolves supported hosts and rejects unknown hosts", () => {
  assert.equal(resolveRuntimeTarget("win32", "x64"), "win-x64");
  assert.equal(resolveRuntimeTarget("darwin", "arm64"), "darwin-arm64");
  assert.equal(resolveRuntimeTarget("darwin", "x64"), "darwin-x64");
  assert.throws(
    () => resolveRuntimeTarget("linux", "x64"),
    /Unsupported Node runtime target: linux-x64/,
  );
});

test("uses Tauri target-triple sidecar names", () => {
  assert.equal(
    tauriBinaryName("x86_64-pc-windows-msvc", true),
    "node-x86_64-pc-windows-msvc.exe",
  );
  assert.equal(
    tauriBinaryName("aarch64-apple-darwin", false),
    "node-aarch64-apple-darwin",
  );
});

test("extracts a checksum-verified tar runtime without network access", async (t) => {
  const fixture = await createFixture(t);
  const binary = Buffer.from("fixture darwin node");
  const archive = tarGz([{ name: `node-v${VERSION}-darwin-arm64/bin/node`, data: binary }]);
  const result = await prepareFixture({
    fixture,
    target: "darwin-arm64",
    archive,
    archiveName: `node-v${VERSION}-darwin-arm64.tar.gz`,
    targetTriple: "aarch64-apple-darwin",
  });

  assert.equal(result.prepared, true);
  assert.equal(path.basename(result.binaryPath), "node-aarch64-apple-darwin");
  assert.deepEqual(await readFile(result.binaryPath), binary);
});

test("stages the bundled npm CLI tree from the verified Node archive", async (t) => {
  const fixture = await createFixture(t);
  const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const archive = tarGz([
    { name: `node-v${VERSION}-darwin-arm64/bin/node`, data: Buffer.from("node") },
    { name: `node-v${VERSION}-darwin-arm64/bin/npm`, data: Buffer.alloc(0), type: "2" },
    {
      name: `node-v${VERSION}-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js`,
      data: Buffer.from("console.log('npm')\n"),
    },
    {
      name: `node-v${VERSION}-darwin-arm64/lib/node_modules/npm/package.json`,
      data: Buffer.from(JSON.stringify({ name: "npm", version: "11.6.2" })),
    },
    {
      name: `node-v${VERSION}-darwin-arm64/lib/node_modules/npm/node_modules/fixture/index.js`,
      data: Buffer.from("export default true\n"),
    },
  ]);

  const result = await prepareFixture({
    fixture,
    target: "darwin-arm64",
    archive,
    archiveName,
    targetTriple: "aarch64-apple-darwin",
    npmResourceDirectory,
  });

  assert.equal(result.npmResourcePath, npmResourceDirectory);
  assert.match(
    await readFile(path.join(npmResourceDirectory, "bin", "npm-cli.js"), "utf8"),
    /npm/,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(npmResourceDirectory, "package.json"), "utf8")).name,
    "npm",
  );
  assert.match(
    await readFile(
      path.join(npmResourceDirectory, "node_modules", "fixture", "index.js"),
      "utf8",
    ),
    /true/,
  );
});

test("extracts a checksum-verified Windows zip runtime", async (t) => {
  const fixture = await createFixture(t);
  const binary = Buffer.from("fixture windows node");
  const archive = zip([{ name: `node-v${VERSION}-win-x64/node.exe`, data: binary }]);
  const result = await prepareFixture({
    fixture,
    target: "win-x64",
    archive,
    archiveName: `node-v${VERSION}-win-x64.zip`,
    targetTriple: "x86_64-pc-windows-msvc",
  });

  assert.equal(path.basename(result.binaryPath), "node-x86_64-pc-windows-msvc.exe");
  assert.deepEqual(await readFile(result.binaryPath), binary);
});

test("rejects a runtime archive whose checksum does not match", async (t) => {
  const fixture = await createFixture(t);
  const archive = tarGz([
    { name: `node-v${VERSION}-darwin-x64/bin/node`, data: Buffer.from("node") },
  ]);
  const archivePath = path.join(fixture.root, "runtime.tar.gz");
  await writeFile(archivePath, archive);

  await assert.rejects(
    prepareNodeRuntime({
      target: "darwin-x64",
      manifest: manifestFor({
        target: "darwin-x64",
        archiveName: `node-v${VERSION}-darwin-x64.tar.gz`,
        targetTriple: "x86_64-apple-darwin",
        sha256: "0".repeat(64),
      }),
      outputDirectory: fixture.output,
      acquireArchive: async () => archivePath,
    }),
    /SHA-256 mismatch/,
  );
});

test("is idempotent and does not reacquire an already prepared runtime", async (t) => {
  const fixture = await createFixture(t);
  const archive = tarGz([
    { name: `node-v${VERSION}-darwin-x64/bin/node`, data: Buffer.from("node") },
  ]);
  const archivePath = path.join(fixture.root, "runtime.tar.gz");
  await writeFile(archivePath, archive);
  let acquisitions = 0;
  const options = {
    target: "darwin-x64",
    manifest: manifestFor({
      target: "darwin-x64",
      archiveName: `node-v${VERSION}-darwin-x64.tar.gz`,
      targetTriple: "x86_64-apple-darwin",
      sha256: sha256(archive),
    }),
    outputDirectory: fixture.output,
    acquireArchive: async () => {
      acquisitions += 1;
      return archivePath;
    },
  };

  assert.equal((await prepareNodeRuntime(options)).prepared, true);
  assert.equal((await prepareNodeRuntime(options)).prepared, false);
  assert.equal(acquisitions, 1);
});

test("serializes sixteen concurrent binary and npm preparations", async (t) => {
  const fixture = await createFixture(t);
  const binary = Buffer.from("concurrent node");
  const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const archive = runtimeArchive({
    target: "darwin-arm64",
    binary,
    npmVersion: "11.6.2",
  });
  const archivePath = path.join(fixture.root, archiveName);
  await writeFile(archivePath, archive);
  let acquisitions = 0;
  const options = {
    target: "darwin-arm64",
    manifest: manifestFor({
      target: "darwin-arm64",
      archiveName,
      targetTriple: "aarch64-apple-darwin",
      sha256: sha256(archive),
    }),
    outputDirectory: fixture.output,
    npmResourceDirectory,
    acquireArchive: async () => {
      acquisitions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return archivePath;
    },
  };

  const results = await Promise.all(
    Array.from({ length: 16 }, () => prepareNodeRuntime(options)),
  );

  assert.equal(results.filter((result) => result.prepared).length, 1);
  assert.equal(acquisitions, 1);
  assert.deepEqual(await readFile(results[0].binaryPath), binary);
  assert.equal(
    JSON.parse(await readFile(path.join(npmResourceDirectory, "package.json"), "utf8")).version,
    "11.6.2",
  );
  assert.deepEqual(
    (await readdir(fixture.output)).filter((name) => name.includes(".tmp")),
    [],
  );
});

test("ownerless and replaced legacy locks cannot block or be recursively deleted", async (t) => {
  for (const scenario of ["ownerless", "replaced-owner"]) {
    await t.test(scenario, async () => {
      const fixture = await createFixture(t);
      const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
      const archive = runtimeArchive({
        target: "darwin-arm64",
        binary: Buffer.from(`lease node ${scenario}`),
        npmVersion: "11.6.2",
      });
      const archivePath = path.join(fixture.root, archiveName);
      await writeFile(archivePath, archive);
      const binaryPath = path.join(fixture.output, "node-aarch64-apple-darwin");
      const lockPath = `${binaryPath}.prepare.lock`;
      await mkdir(lockPath, { recursive: true });
      const ownerPath = path.join(lockPath, "owner.json");
      if (scenario === "replaced-owner") {
        await writeFile(ownerPath, JSON.stringify({ pid: process.pid, token: scenario }));
      }

      const fallback = setTimeout(() => rm(lockPath, { force: true, recursive: true }), 250);
      const started = Date.now();
      await prepareNodeRuntime(runtimeOptions({
        archive,
        archiveName,
        archivePath,
        fixture,
      }));
      clearTimeout(fallback);

      assert.ok(Date.now() - started < 200, "legacy lock metadata blocked lease acquisition");
      if (scenario === "replaced-owner") {
        assert.equal(
          JSON.parse(await readFile(ownerPath, "utf8")).token,
          scenario,
          "lock acquisition recursively deleted another owner's metadata",
        );
      }
    });
  }
});

test("removes only a dead immutable lease and waits for its live replacement", async (t) => {
  const fixture = await createFixture(t);
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const archive = runtimeArchive({
    target: "darwin-arm64",
    binary: Buffer.from("replacement lease node"),
    npmVersion: "11.6.2",
  });
  const archivePath = path.join(fixture.root, archiveName);
  await writeFile(archivePath, archive);
  const lockPath = path.join(
    fixture.output,
    "node-aarch64-apple-darwin.prepare.lock",
  );
  await mkdir(lockPath, { recursive: true });
  const staleCreatedAt = Date.now() - 20;
  const staleToken = `99999999-${randomUUID()}`;
  const staleLease = path.join(lockPath, `${staleCreatedAt}-${staleToken}.lease`);
  await writeFile(staleLease, JSON.stringify({
    createdAt: staleCreatedAt,
    pid: 99999999,
    token: staleToken,
  }));
  const liveCreatedAt = Date.now() - 10;
  const liveToken = `${process.pid}-${randomUUID()}`;
  const liveLease = path.join(lockPath, `${liveCreatedAt}-${liveToken}.lease`);
  await writeFile(liveLease, JSON.stringify({
    createdAt: liveCreatedAt,
    pid: process.pid,
    token: liveToken,
  }));

  const release = setTimeout(() => rm(liveLease, { force: true }), 80);
  const started = Date.now();
  await prepareNodeRuntime(runtimeOptions({
    archive,
    archiveName,
    archivePath,
    fixture,
  }));
  clearTimeout(release);

  assert.ok(Date.now() - started >= 60, "contender did not wait for the live replacement lease");
  await assert.rejects(readFile(staleLease), { code: "ENOENT" });
});

test("serializes runtime publication under repeated cross-process contention", async (t) => {
  const fixture = await createFixture(t);
  const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const archive = runtimeArchive({
    target: "darwin-arm64",
    binary: Buffer.from("cross-process node"),
    npmVersion: "11.6.2",
  });
  const archivePath = path.join(fixture.root, archiveName);
  const acquisitionLog = path.join(fixture.root, "acquisitions.log");
  await writeFile(archivePath, archive);
  const options = runtimeOptions({
    archive,
    archiveName,
    archivePath,
    fixture,
    npmResourceDirectory,
  });
  const moduleUrl = pathToFileURL(
    path.join(path.dirname(new URL(import.meta.url).pathname), "prepare-node-runtime.mjs"),
  ).href;
  const childSource = `
    import { appendFile } from "node:fs/promises";
    import { prepareNodeRuntime } from ${JSON.stringify(moduleUrl)};
    const options = JSON.parse(process.env.LOCALAPP_RUNTIME_OPTIONS);
    options.acquireArchive = async () => {
      await appendFile(process.env.LOCALAPP_ACQUISITION_LOG, "acquired\\n");
      await new Promise(resolve => setTimeout(resolve, 20));
      return process.env.LOCALAPP_ARCHIVE_PATH;
    };
    await prepareNodeRuntime(options);
  `;

  for (let round = 0; round < 4; round += 1) {
    await Promise.all(Array.from({ length: 16 }, () => runChild(process.execPath, [
      "--input-type=module",
      "--eval",
      childSource,
    ], {
      ...process.env,
      LOCALAPP_ACQUISITION_LOG: acquisitionLog,
      LOCALAPP_ARCHIVE_PATH: archivePath,
      LOCALAPP_RUNTIME_OPTIONS: JSON.stringify({
        ...options,
        acquireArchive: undefined,
      }),
    })));
  }

  assert.equal((await readFile(acquisitionLog, "utf8")).trim().split("\n").length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(npmResourceDirectory, "package.json"), "utf8")).version,
    "11.6.2",
  );
});

test("retains the journal and snapshots when restoration fails, then retries recovery", async (t) => {
  const fixture = await createFixture(t);
  const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const priorArchive = runtimeArchive({
    target: "darwin-arm64",
    binary: Buffer.from("prior recoverable node"),
    npmVersion: "11.6.1",
  });
  const replacementArchive = runtimeArchive({
    target: "darwin-arm64",
    binary: Buffer.from("replacement recoverable node"),
    npmVersion: "11.6.2",
  });
  const priorPath = path.join(fixture.root, "prior-recovery.tar.gz");
  const replacementPath = path.join(fixture.root, "replacement-recovery.tar.gz");
  await writeFile(priorPath, priorArchive);
  await writeFile(replacementPath, replacementArchive);
  const priorOptions = runtimeOptions({
    archive: priorArchive,
    archiveName,
    archivePath: priorPath,
    fixture,
    npmResourceDirectory,
  });
  await prepareNodeRuntime(priorOptions);

  let restoreFailures = 0;
  await assert.rejects(
    prepareNodeRuntime({
      ...runtimeOptions({
        archive: replacementArchive,
        archiveName,
        archivePath: replacementPath,
        fixture,
        npmResourceDirectory,
      }),
      publicationFault: (step) => {
        if (step === "after_npm_publish") throw new Error("publication interrupted");
      },
      restoreFault: (step) => {
        if (step === "before_restore_binary" && restoreFailures++ === 0) {
          throw new Error("restore interrupted");
        }
      },
    }),
    /restore interrupted/,
  );

  const binaryPath = path.join(fixture.output, "node-aarch64-apple-darwin");
  const journalPath = `${binaryPath}.publication.json`;
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  assert.equal(await readFile(journal.snapshot.binary, "utf8"), "prior recoverable node");
  assert.equal(
    JSON.parse(await readFile(path.join(journal.snapshot.npm, "package.json"), "utf8")).version,
    "11.6.1",
  );

  const recovered = await prepareNodeRuntime({
    ...priorOptions,
    acquireArchive: async () => {
      throw new Error("recovery should recognize the prior install");
    },
  });
  assert.equal(recovered.prepared, false);
  assert.equal(await readFile(recovered.binaryPath, "utf8"), "prior recoverable node");
  assert.equal(
    JSON.parse(await readFile(path.join(npmResourceDirectory, "package.json"), "utf8")).version,
    "11.6.1",
  );
  await assert.rejects(readFile(journalPath), { code: "ENOENT" });
});

test("fsyncs publication files and parent directories around atomic renames", async (t) => {
  const fixture = await createFixture(t);
  const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
  const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
  const archive = runtimeArchive({
    target: "darwin-arm64",
    binary: Buffer.from("durable node"),
    npmVersion: "11.6.2",
  });
  const archivePath = path.join(fixture.root, archiveName);
  await writeFile(archivePath, archive);
  const events = [];

  await prepareNodeRuntime({
    ...runtimeOptions({ archive, archiveName, archivePath, fixture, npmResourceDirectory }),
    durabilityObserver: (event) => events.push(event),
  });

  assert.ok(events.includes("file_sync"));
  assert.ok(events.includes("directory_sync_before_rename"));
  assert.ok(events.includes("directory_sync_after_rename"));
});

test("publication faults preserve the prior recognized binary and npm install", async (t) => {
  for (const faultStep of [
    "after_staging",
    "after_npm_publish",
    "after_marker_publish",
    "after_binary_publish",
  ]) {
    await t.test(faultStep, async () => {
      const fixture = await createFixture(t);
      const npmResourceDirectory = path.join(fixture.root, "resources", "npm");
      const archiveName = `node-v${VERSION}-darwin-arm64.tar.gz`;
      const priorArchive = runtimeArchive({
        target: "darwin-arm64",
        binary: Buffer.from("prior node"),
        npmVersion: "11.6.1",
      });
      const replacementArchive = runtimeArchive({
        target: "darwin-arm64",
        binary: Buffer.from("replacement node"),
        npmVersion: "11.6.2",
      });
      const priorPath = path.join(fixture.root, `prior-${faultStep}.tar.gz`);
      const replacementPath = path.join(fixture.root, `replacement-${faultStep}.tar.gz`);
      await writeFile(priorPath, priorArchive);
      await writeFile(replacementPath, replacementArchive);
      const priorOptions = runtimeOptions({
        archive: priorArchive,
        archiveName,
        archivePath: priorPath,
        fixture,
        npmResourceDirectory,
      });
      await prepareNodeRuntime(priorOptions);

      await assert.rejects(
        prepareNodeRuntime({
          ...runtimeOptions({
            archive: replacementArchive,
            archiveName,
            archivePath: replacementPath,
            fixture,
            npmResourceDirectory,
          }),
          publicationFault: (step) => {
            if (step === faultStep) throw new Error(`fault:${step}`);
          },
        }),
        new RegExp(`fault:${faultStep}`),
      );

      let reacquired = false;
      const reused = await prepareNodeRuntime({
        ...priorOptions,
        acquireArchive: async () => {
          reacquired = true;
          throw new Error("prior install was not recognized");
        },
      });
      assert.equal(reused.prepared, false);
      assert.equal(reacquired, false);
      assert.equal(await readFile(reused.binaryPath, "utf8"), "prior node");
      assert.equal(
        JSON.parse(await readFile(path.join(npmResourceDirectory, "package.json"), "utf8")).version,
        "11.6.1",
      );
    });
  }
});

test("keeps an existing binary when marker publication fails", async (t) => {
  const fixture = await createFixture(t);
  const binaryPath = path.join(fixture.output, "node-aarch64-apple-darwin");
  const markerPath = `${binaryPath}.node-runtime.json`;
  await mkdir(fixture.output, { recursive: true });
  await writeFile(binaryPath, "known-good node");
  await mkdir(markerPath);

  await assert.rejects(
    publishPreparedRuntime({
      binary: Buffer.from("replacement node"),
      binaryPath,
      marker: { version: VERSION },
      markerPath,
    }),
  );

  assert.equal(await readFile(binaryPath, "utf8"), "known-good node");
});

test("rejects path traversal before extracting any archive entry", async (t) => {
  const fixture = await createFixture(t);
  const archive = tarGz([
    { name: "../escaped-node", data: Buffer.from("escape") },
    { name: `node-v${VERSION}-darwin-arm64/bin/node`, data: Buffer.from("node") },
  ]);

  await assert.rejects(
    prepareFixture({
      fixture,
      target: "darwin-arm64",
      archive,
      archiveName: `node-v${VERSION}-darwin-arm64.tar.gz`,
      targetTriple: "aarch64-apple-darwin",
    }),
    /Unsafe archive path/,
  );
});

test("keeps frontend commands offline and declares fixed Tauri runtime artifacts", async () => {
  const desktopDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const packageJson = JSON.parse(await readFile(path.join(desktopDirectory, "package.json"), "utf8"));
  const tauriConfig = JSON.parse(
    await readFile(path.join(desktopDirectory, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const viteConfig = await readFile(path.join(desktopDirectory, "vite.config.ts"), "utf8");
  const styles = await readFile(path.join(desktopDirectory, "src", "styles.css"), "utf8");
  const ignoreRules = await readFile(path.join(desktopDirectory, ".gitignore"), "utf8");

  assert.equal(packageJson.scripts.build, "pnpm runtime:bundle && tsc --noEmit && vite build");
  assert.equal(packageJson.scripts.test, "vitest run");
  assert.equal(packageJson.scripts["runtime:prepare"], "node scripts/prepare-node-runtime.mjs");
  assert.equal(packageJson.scripts["runtime:bundle"], "node scripts/build-local-runtime.mjs");
  assert.equal(packageJson.scripts.tauri, "node scripts/run-tauri.mjs");
  assert.deepEqual(tauriConfig.bundle.externalBin, ["binaries/node"]);
  assert.deepEqual(tauriConfig.bundle.resources, {
    "resources/local-runtime": "local-runtime",
    "resources/npm": "npm",
    "runner/localapp-runner.mjs": "runner/localapp-runner.mjs",
  });
  assert.deepEqual(tauriConfig.plugins.updater, {
    endpoints: [],
    pubkey: "development-only",
  });
  assert.equal(tauriConfig.build.devUrl, "http://localhost:1420");
  assert.match(viteConfig, /port:\s*1420/);
  assert.match(viteConfig, /strictPort:\s*true/);
  assert.match(viteConfig, /ignored:\s*\["\*\*\/src-tauri\/target\/\*\*"\]/);
  assert.match(styles, /html, body, #root\s*\{[^}]*height:\s*100%/s);
  assert.match(styles, /body\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.desktop-shell\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.workspace, \.content-area\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(styles, /\.view-stack:not\(\.tasks-view\)\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.messages-main\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.task-detail-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /--bg:\s*#f5f6f8/);
  assert.match(styles, /--fg:\s*#1d2430/);
  assert.match(styles, /--muted:\s*#667085/);
  assert.match(styles, /--border:\s*#d8dde6/);
  assert.match(styles, /--accent:\s*#c90000/);
  assert.match(styles, /--accent-hover:\s*#a90000/);
  assert.doesNotMatch(styles, /--accent:\s*oklch/);
  assert.doesNotMatch(styles, /\.nav-button\.is-active\s*\{[^}]*box-shadow:\s*inset/s);
  assert.doesNotMatch(styles, /\.message-source\.is-selected\s*\{[^}]*box-shadow:\s*inset/s);
  assert.doesNotMatch(styles, /\.task-index-row\.is-selected\s*\{[^}]*box-shadow:\s*inset/s);
  assert.match(styles, /\.messages-heading\s*\{[^}]*min-height:\s*56px[^}]*border-bottom:\s*1px solid var\(--border\)/s);
  assert.match(styles, /\.messages-main\s*\{\s*padding:\s*0 26px 40px;\s*\}/);
  assert.match(ignoreRules, /^\/src-tauri\/binaries\/$/m);
  assert.match(ignoreRules, /^\/src-tauri\/resources\/$/m);
  assert.match(ignoreRules, /^\/src-tauri\/gen\/$/m);
  assert.doesNotMatch(ignoreRules, /runner/);
});

test("clean-checkout Tauri build prepares runtime artifacts before launching Tauri", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localapp-tauri-package-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const binaryPath = path.join(root, "src-tauri", "binaries", "node-test-target");
  const npmCliPath = path.join(root, "src-tauri", "resources", "npm", "bin", "npm-cli.js");
  const order = [];

  const exitCode = await runTauri({
    arguments_: ["build", "--no-bundle"],
    prepareRuntime: async () => {
      order.push("prepare");
      await mkdir(path.dirname(binaryPath), { recursive: true });
      await mkdir(path.dirname(npmCliPath), { recursive: true });
      await writeFile(binaryPath, "node");
      await writeFile(npmCliPath, "npm");
    },
    launchTauri: async (arguments_) => {
      order.push("tauri");
      assert.deepEqual(arguments_, ["build", "--no-bundle"]);
      assert.equal(await readFile(binaryPath, "utf8"), "node");
      assert.equal(await readFile(npmCliPath, "utf8"), "npm");
      return 0;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(order, ["prepare", "tauri"]);
});

test("Tauri wrapper finds a packaging command after global flags", async () => {
  const calls = [];
  await runTauri({
    arguments_: ["--verbose", "build", "--no-bundle"],
    prepareRuntime: async (options) => calls.push(options),
    launchTauri: async () => 0,
  });
  assert.deepEqual(calls, [{}]);
});

test("Tauri wrapper prepares the runtime matching an explicit target triple", async () => {
  const calls = [];
  await runTauri({
    arguments_: ["build", "--target", "x86_64-pc-windows-msvc"],
    prepareRuntime: async (options) => calls.push(options),
    launchTauri: async () => 0,
  });
  assert.deepEqual(calls, [{ target: "win-x64" }]);
});

test("Tauri wrapper supports the official short target option", async () => {
  const calls = [];
  await runTauri({
    arguments_: ["build", "-t", "x86_64-apple-darwin"],
    prepareRuntime: async (options) => calls.push(options),
    launchTauri: async () => 0,
  });
  assert.deepEqual(calls, [{ target: "darwin-x64" }]);
});

test("Tauri wrapper does not mistake another command argument for build", async () => {
  const calls = [];
  await runTauri({
    arguments_: ["icon", "--output", "build"],
    prepareRuntime: async (options) => calls.push(options),
    launchTauri: async () => 0,
  });
  assert.deepEqual(calls, []);
});

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "localapp-node-runtime-"));
  const output = path.join(root, "binaries");
  t.after(() => rm(root, { force: true, recursive: true }));
  return { root, output };
}

async function prepareFixture({
  fixture,
  target,
  archive,
  archiveName,
  targetTriple,
  npmResourceDirectory,
}) {
  const archivePath = path.join(fixture.root, archiveName);
  await writeFile(archivePath, archive);
  return prepareNodeRuntime({
    target,
    manifest: manifestFor({
      target,
      archiveName,
      targetTriple,
      sha256: sha256(archive),
    }),
    outputDirectory: fixture.output,
    npmResourceDirectory,
    acquireArchive: async () => archivePath,
  });
}

function manifestFor({ target, archiveName, targetTriple, sha256: checksum }) {
  return {
    version: VERSION,
    targets: {
      [target]: {
        archive: archiveName,
        sha256: checksum,
        targetTriple,
      },
    },
  };
}

function runtimeArchive({ target, binary, npmVersion }) {
  const root = `node-v${VERSION}-${target}`;
  return tarGz([
    { name: `${root}/bin/node`, data: binary },
    {
      name: `${root}/lib/node_modules/npm/bin/npm-cli.js`,
      data: Buffer.from("console.log('npm')\n"),
    },
    {
      name: `${root}/lib/node_modules/npm/package.json`,
      data: Buffer.from(JSON.stringify({ name: "npm", version: npmVersion })),
    },
  ]);
}

function runtimeOptions({
  archive,
  archiveName,
  archivePath,
  fixture,
  npmResourceDirectory,
}) {
  return {
    target: "darwin-arm64",
    manifest: manifestFor({
      target: "darwin-arm64",
      archiveName,
      targetTriple: "aarch64-apple-darwin",
      sha256: sha256(archive),
    }),
    outputDirectory: fixture.output,
    npmResourceDirectory,
    acquireArchive: async () => archivePath,
  };
}

function runChild(command, arguments_, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && !signal) resolve();
      else reject(new Error(`child failed code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function tarGz(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, entry.name);
    writeTarOctal(header, 100, 8, 0o755);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, entry.data.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    writeTarString(header, 257, 6, "ustar");
    writeTarString(header, 263, 2, "00");
    writeTarOctal(
      header,
      148,
      8,
      [...header].reduce((sum, byte) => sum + byte, 0),
    );
    blocks.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeTarString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeTarOctal(buffer, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0") + "\0";
  buffer.write(encoded, offset, length, "ascii");
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);

    localParts.push(local, name, entry.data);
    centralParts.push(central, name);
    localOffset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
