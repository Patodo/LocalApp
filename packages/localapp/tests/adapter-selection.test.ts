import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectNativeAdapter } from "../src/native/adapter-selection.js";

const root = path.resolve(process.cwd(), "../../tmp/task-8-adapter-selection");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("native adapter selection", () => {
  it("selects only the exact platform and architecture after verifying every asset digest", async () => {
    const directory = await fixture("darwin-arm64");
    await expect(selectNativeAdapter({ root: directory, platform: "darwin", arch: "arm64" })).resolves.toMatchObject({
      target: "darwin-arm64",
      executable: path.join(directory, "darwin-arm64", "LocalAppBridge.app", "Contents", "MacOS", "LocalAppBridge"),
    });
  });

  it("fails closed for missing, mismatched, and tampered target assets", async () => {
    const directory = await fixture("darwin-arm64");
    await expect(selectNativeAdapter({ root: directory, platform: "aix", arch: "ppc64" })).rejects.toMatchObject({ code: "native_adapter_unsupported" });
    await expect(selectNativeAdapter({ root: directory, platform: "darwin", arch: "x64" })).rejects.toMatchObject({ code: "native_adapter_unsupported" });
    await fs.appendFile(path.join(directory, "darwin-arm64", "LocalAppBridge.app", "Contents", "MacOS", "LocalAppBridge"), "tampered");
    await expect(selectNativeAdapter({ root: directory, platform: "darwin", arch: "arm64" })).rejects.toMatchObject({ code: "native_adapter_digest_invalid" });
  });
});

async function fixture(target: string): Promise<string> {
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "fixture-"));
  directories.push(directory);
  const executable = path.join(directory, target, "LocalAppBridge.app", "Contents", "MacOS", "LocalAppBridge");
  const ipcClient = path.join(directory, target, "LocalAppBridge.app", "Contents", "Resources", "localapp-native-ipc-client.mjs");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "native bridge\n", { mode: 0o755 });
  await fs.mkdir(path.dirname(ipcClient), { recursive: true });
  await fs.writeFile(ipcClient, "native client\n", { mode: 0o755 });
  const relative = `${target}/LocalAppBridge.app/Contents/MacOS/LocalAppBridge`;
  const clientRelative = `${target}/LocalAppBridge.app/Contents/Resources/localapp-native-ipc-client.mjs`;
  await fs.writeFile(path.join(directory, "adapter-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    target,
    signing: { mode: "adhoc" },
    assets: [
      { path: relative, sha256: crypto.createHash("sha256").update("native bridge\n").digest("hex") },
      { path: clientRelative, sha256: crypto.createHash("sha256").update("native client\n").digest("hex") },
    ],
  })}\n`);
  return directory;
}
