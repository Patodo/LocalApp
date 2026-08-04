import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildWindowsReleaseConfig } from "./windows-release-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./windows-release-config.mjs", import.meta.url));
const REQUIRED_ENV = {
  LOCALAPP_UPDATER_ENDPOINT:
    "https://updates.localapp.example/{{target}}/{{arch}}/{{current_version}}",
  LOCALAPP_UPDATER_PUBKEY: "untrusted comment: minisign public key\nRWQexample",
};

test("builds the updater and optional Windows signing merge config", () => {
  const config = buildWindowsReleaseConfig({
    ...REQUIRED_ENV,
    LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT:
      "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    LOCALAPP_WINDOWS_TIMESTAMP_URL: "https://timestamp.example.test",
  });

  assert.deepEqual(config, {
    bundle: {
      createUpdaterArtifacts: true,
      windows: {
        certificateThumbprint: "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678",
        digestAlgorithm: "sha256",
        timestampUrl: "https://timestamp.example.test/",
      },
    },
    plugins: {
      updater: {
        endpoints: [REQUIRED_ENV.LOCALAPP_UPDATER_ENDPOINT],
        pubkey: REQUIRED_ENV.LOCALAPP_UPDATER_PUBKEY,
        windows: { installMode: "passive" },
      },
    },
  });
});

test("omits Windows Authenticode settings when no certificate is configured", () => {
  const config = buildWindowsReleaseConfig(REQUIRED_ENV);

  assert.deepEqual(config.bundle.windows, {});
});

test("fails closed when a release-required value is missing", () => {
  assert.throws(
    () => buildWindowsReleaseConfig({ LOCALAPP_UPDATER_PUBKEY: "public-key" }),
    /LOCALAPP_UPDATER_ENDPOINT is required/,
  );
  assert.throws(
    () => buildWindowsReleaseConfig({ LOCALAPP_UPDATER_ENDPOINT: "https://updates.example.test" }),
    /LOCALAPP_UPDATER_PUBKEY is required/,
  );
});

test("requires HTTPS updater and timestamp endpoints", () => {
  assert.throws(
    () => buildWindowsReleaseConfig({
      ...REQUIRED_ENV,
      LOCALAPP_UPDATER_ENDPOINT: "http://updates.example.test/latest.json",
    }),
    /LOCALAPP_UPDATER_ENDPOINT must use HTTPS/,
  );
  assert.throws(
    () => buildWindowsReleaseConfig({
      ...REQUIRED_ENV,
      LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT:
        "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678",
      LOCALAPP_WINDOWS_TIMESTAMP_URL: "http://timestamp.example.test",
    }),
    /LOCALAPP_WINDOWS_TIMESTAMP_URL must use HTTPS/,
  );
});

test("rejects malformed certificate thumbprints and partial timestamp signing config", () => {
  assert.throws(
    () => buildWindowsReleaseConfig({
      ...REQUIRED_ENV,
      LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT: "not-a-sha1-thumbprint",
    }),
    /must be a 40-character SHA-1 certificate thumbprint/,
  );
  assert.throws(
    () => buildWindowsReleaseConfig({
      ...REQUIRED_ENV,
      LOCALAPP_WINDOWS_TIMESTAMP_URL: "https://timestamp.example.test",
    }),
    /requires LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT/,
  );
});

test("CLI writes only public release settings to --output", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "localapp-release-config-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const outputPath = path.join(directory, "tauri-release.json");
  const privateValues = {
    LOCALAPP_WINDOWS_CERTIFICATE_PFX_BASE64: "base64-private-pfx",
    LOCALAPP_WINDOWS_CERTIFICATE_PFX_PASSWORD: "example-pfx-password",
    TAURI_SIGNING_PRIVATE_KEY: "updater-private-key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "example-updater-key-password",
  };

  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--output", outputPath], {
    encoding: "utf8",
    env: { ...process.env, ...REQUIRED_ENV, ...privateValues },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  const content = await readFile(outputPath, "utf8");
  const config = JSON.parse(content);
  assert.deepEqual(config.plugins.updater.endpoints, [REQUIRED_ENV.LOCALAPP_UPDATER_ENDPOINT]);
  for (const secret of Object.values(privateValues)) assert.doesNotMatch(content, new RegExp(secret));
});

test("CLI requires exactly one --output argument", () => {
  for (const arguments_ of [[], ["--unknown"], ["--output"], ["--output", "a", "extra"]]) {
    const result = spawnSync(process.execPath, [SCRIPT_PATH, ...arguments_], {
      encoding: "utf8",
      env: { ...process.env, ...REQUIRED_ENV },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  }
});
