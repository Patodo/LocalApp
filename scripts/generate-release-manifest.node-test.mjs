import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReleaseManifest, verifyReleaseOutputs } from "./generate-release-manifest.mjs";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-release-"));
  const filename = "localapp-1.2.3.tgz";
  fs.writeFileSync(path.join(directory, filename), "localapp npm package");
  return { directory, filename };
}

test("publishes the single scoped localapp npm tarball as the only product asset", () => {
  const { directory, filename } = fixture();
  try {
    const result = buildReleaseManifest({
      assetsDir: directory,
      outputDir: directory,
      baseUrl: "https://github.com/example/localapp/releases/download/v1.2.3",
      version: "1.2.3",
      minVersion: "1.0.0",
      generatedAt: "2026-08-13T00:00:00.000Z",
    });

    assert.deepEqual(result.manifest.assets.map(({ kind, package: packageName, filename: assetFilename, os, arch, signature }) => ({
      kind,
      package: packageName,
      filename: assetFilename,
      os,
      arch,
      signature,
    })), [{
      kind: "npm",
      package: "@patodo/localapp",
      filename,
      os: "any",
      arch: "any",
      signature: "not-applicable",
    }]);
    assert.equal(fs.readFileSync(result.checksumsPath, "utf8").trim().endsWith(`  ${filename}`), true);
    verifyReleaseOutputs({
      assetsDir: directory,
      manifestPath: result.manifestPath,
      checksumsPath: result.checksumsPath,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails closed when the versioned npm tarball is absent", () => {
  const { directory, filename } = fixture();
  try {
    fs.rmSync(path.join(directory, filename));
    assert.throws(() => buildReleaseManifest({
      assetsDir: directory,
      baseUrl: "https://releases.example/v1.2.3",
      version: "1.2.3",
    }), /required release asset is missing: localapp-1\.2\.3\.tgz/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("detects a tarball changed after manifest generation", () => {
  const { directory, filename } = fixture();
  try {
    const result = buildReleaseManifest({
      assetsDir: directory,
      baseUrl: "https://releases.example/v1.2.3",
      version: "1.2.3",
    });
    fs.appendFileSync(path.join(directory, filename), "tampered");

    assert.throws(() => verifyReleaseOutputs({
      assetsDir: directory,
      manifestPath: result.manifestPath,
      checksumsPath: result.checksumsPath,
    }), /integrity mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts complete SemVer and rejects malformed versions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-semver-"));
  try {
    fs.writeFileSync(path.join(directory, "localapp-1.2.3-rc.1+build.7.tgz"), "package");
    assert.doesNotThrow(() => buildReleaseManifest({
      assetsDir: directory,
      outputDir: directory,
      baseUrl: "https://releases.example/v1.2.3-rc.1+build.7",
      version: "1.2.3-rc.1+build.7",
      minVersion: "1.0.0+baseline",
    }));

    for (const version of ["01.2.3", "1.2.3-", "1.2.3-01", "1.2.3+"]) {
      assert.throws(() => buildReleaseManifest({
        assetsDir: directory,
        outputDir: directory,
        baseUrl: "https://releases.example/invalid",
        version,
      }), /semantic versions/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
