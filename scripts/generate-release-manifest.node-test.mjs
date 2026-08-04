import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReleaseManifest, verifyReleaseOutputs } from "./generate-release-manifest.mjs";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-release-"));
  const files = [
    "localapp-cli-x86_64-unknown-linux-gnu",
    "localapp-cli-aarch64-apple-darwin",
    "localapp-cli-x86_64-apple-darwin",
    "localapp-cli-x86_64-pc-windows-msvc.exe",
    "localapp-desktop-windows-x86_64-setup.exe",
  ];
  const statuses = {};
  for (const filename of files) {
    fs.writeFileSync(path.join(directory, filename), `asset:${filename}`);
    statuses[filename] = filename.includes("apple") ? "ad-hoc" : "unsigned";
  }
  return { directory, files, statuses };
}

test("generates one verified manifest entry and checksum per declared asset", () => {
  const { directory, files, statuses } = fixture();
  try {
    const result = buildReleaseManifest({
      assetsDir: directory,
      outputDir: directory,
      baseUrl: "https://github.com/example/localapp/releases/download/v1.2.3",
      version: "1.2.3",
      minVersion: "1.0.0",
      generatedAt: "2026-07-30T00:00:00.000Z",
      signatureStatuses: statuses,
    });

    assert.equal(result.manifest.assets.length, files.length);
    assert.equal(new Set(result.manifest.assets.map((asset) => asset.filename)).size, files.length);
    assert.ok(result.manifest.assets.every((asset) => asset.url.startsWith("https://github.com/")));
    verifyReleaseOutputs({
      assetsDir: directory,
      manifestPath: result.manifestPath,
      checksumsPath: result.checksumsPath,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fails closed for a missing asset or an unverified signature status", () => {
  const { directory, files, statuses } = fixture();
  try {
    fs.rmSync(path.join(directory, files[0]));
    assert.throws(() => buildReleaseManifest({
      assetsDir: directory,
      baseUrl: "https://releases.example/v1.2.3",
      version: "1.2.3",
      signatureStatuses: statuses,
    }), /missing/);

    fs.writeFileSync(path.join(directory, files[0]), "restored");
    delete statuses[files[1]];
    assert.throws(() => buildReleaseManifest({
      assetsDir: directory,
      baseUrl: "https://releases.example/v1.2.3",
      version: "1.2.3",
      signatureStatuses: statuses,
    }), /signature status/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("detects an asset changed after manifest generation", () => {
  const { directory, files, statuses } = fixture();
  try {
    const result = buildReleaseManifest({
      assetsDir: directory,
      baseUrl: "https://releases.example/v1.2.3",
      version: "1.2.3",
      signatureStatuses: statuses,
    });
    fs.appendFileSync(path.join(directory, files[0]), "tampered");

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
  const { directory, statuses } = fixture();
  try {
    assert.doesNotThrow(() => buildReleaseManifest({
      assetsDir: directory,
      outputDir: directory,
      baseUrl: "https://releases.example/v1.2.3-rc.1+build.7",
      version: "1.2.3-rc.1+build.7",
      minVersion: "1.0.0+baseline",
      signatureStatuses: statuses,
    }));

    for (const version of ["01.2.3", "1.2.3-", "1.2.3-01", "1.2.3+"]) {
      assert.throws(() => buildReleaseManifest({
        assetsDir: directory,
        outputDir: directory,
        baseUrl: "https://releases.example/invalid",
        version,
        signatureStatuses: statuses,
      }), /semantic versions/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
