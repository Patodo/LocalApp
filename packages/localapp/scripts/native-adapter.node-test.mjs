import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildNativeAdapter } from "./build-native-adapter.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(repositoryRoot, "tmp/task-8-native-acceptance");

test("ad-hoc signed macOS bridge forwards exactly one real Scheme URL to the repository-local daemon", { skip: process.platform !== "darwin" }, async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });

  const runtimeDir = path.join(testRoot, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const endpoint = path.join(runtimeDir, "control.sock");
  const received = [];
  const daemon = net.createServer((socket) => {
    let frame = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { frame += chunk; });
    socket.on("end", () => {
      received.push(JSON.parse(frame));
      socket.end('{"ok":true,"type":"activation"}\n');
    });
  });
  await new Promise((resolve, reject) => { daemon.once("error", reject); daemon.listen(endpoint, resolve); });
  t.after(async () => { await new Promise((resolve) => daemon.close(resolve)); });

  const bundleIdentifier = `dev.localapp.bridge.task11.p${process.pid}`;
  const built = await buildNativeAdapter({
    outputDirectory: path.join(testRoot, "native"),
    signing: "adhoc",
    bundleIdentifier,
  });
  assert.equal(built.signing.mode, "adhoc");
  const codeSign = await run("/usr/bin/codesign", ["--verify", "--strict", built.appBundle]);
  assert.equal(codeSign.code, 0, codeSign.stderr);
  const manifest = JSON.parse(await fs.readFile(path.join(built.outputDirectory, "adapter-manifest.json"), "utf8"));
  for (const asset of manifest.assets) {
    const bytes = await fs.readFile(path.join(built.outputDirectory, asset.path));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  }

  const malformedNotification = await run(built.executable, ["--show-notification", "{}"]);
  assert.equal(malformedNotification.code, 1, malformedNotification.stderr);
  const iconPath = path.join(testRoot, "notification-icon.png");
  await fs.writeFile(iconPath, "png");
  const notificationEnvelope = {
    identifier: "notification_native_0123456789",
    ticket: "notification_ticket_0123456789",
    productLabel: "LocalApp",
    applicationLabel: "Interview App",
    sourceLabel: "Local server",
    title: "Build complete",
    body: "The task finished",
    priority: "normal",
    iconPath,
  };
  assert.equal((await run(built.executable, ["--validate-notification", JSON.stringify(notificationEnvelope)])).code, 0);
  assert.equal((await run(built.executable, ["--validate-notification", JSON.stringify({ ...notificationEnvelope, url: "https://evil.example" })])).code, 1);
  assert.equal((await run(built.executable, ["--validate-notification", JSON.stringify({ ...notificationEnvelope, title: "<script>run()</script>" })])).code, 1);
  const duplicateTitle = JSON.stringify(notificationEnvelope).replace('"title":"Build complete"', '"title":"first","title":"second"');
  assert.equal((await run(built.executable, ["--validate-notification", duplicateTitle])).code, 1);
  assert.equal((await run(built.executable, ["--request-permission", "unexpected"])).code, 1);
  const bridgeConfigPath = path.join(testRoot, "bridge-runtime.json");
  await fs.writeFile(bridgeConfigPath, `${JSON.stringify({
    nodePath: process.execPath,
    ipcClientPath: built.ipcClient,
    environment: { LOCALAPP_RUNTIME_DIR: runtimeDir },
  })}\n`, { mode: 0o600 });
  // The test owns this identifier, so clear a stale registration left by an
  // interrupted previous acceptance before asserting the new bundle mapping.
  await run(built.executable, ["--unregister"]);
  const registered = await run(built.executable, ["--register", bridgeConfigPath]);
  assert.equal(registered.code, 0, registered.stderr);
  t.after(async () => { await run(built.executable, ["--unregister"]); });
  t.after(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });
  const activationUrl = "localapp://action/11111111-1111-4111-8111-111111111111?origin=https%3A%2F%2Fserver.example.test&nonce=nonce_abcdefghijklmnopqrstuvwxyz-0123456789&protocolVersion=2";
  const direct = await run(built.executable, [activationUrl]);
  assert.equal(direct.code, 0, direct.stderr);
  await waitFor(() => received.length === 1, "one direct bridge IPC activation");
  // Force a fresh short-lived bridge instance. A prior interrupted acceptance
  // may leave a background-only process alive, and LaunchServices otherwise
  // reuses that process with its stale in-memory registration state.
  const opened = await run("/usr/bin/open", ["-n", "-b", bundleIdentifier, activationUrl]);
  assert.equal(opened.code, 0, opened.stderr);
  await waitFor(() => received.length === 2, "one LaunchServices bridge IPC activation");
  const notificationTicket = "notification_ticket_0123456789";
  assert.equal((await run(built.executable, ["--notification-activation-ticket", notificationTicket])).code, 0);
  await waitFor(() => received.length === 3, "one notification click bridge IPC activation");
  assert.deepEqual(received, [
    { type: "activation", url: activationUrl },
    { type: "activation", url: activationUrl },
    { type: "activation", url: `localapp://notification/open?ticket=${notificationTicket}` },
  ]);

  const markerPath = path.join(testRoot, "unexpected-native-spawn");
  const markerClient = path.join(testRoot, "marker-client.mjs");
  await fs.writeFile(markerClient, `import fs from "node:fs/promises"; await fs.writeFile(${JSON.stringify(markerPath)}, "spawned");\n`);
  await fs.writeFile(bridgeConfigPath, `${JSON.stringify({ nodePath: process.execPath, ipcClientPath: markerClient })}\n`, { mode: 0o600 });
  const oversizedActivation = `localapp://notification/open?ticket=${"界".repeat(1_400)}`;
  assert.ok(Buffer.byteLength(oversizedActivation, "utf8") > 4_096);
  assert.equal((await run(built.executable, [oversizedActivation])).code, 1);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await assert.rejects(fs.access(markerPath));
});

test("Linux and Windows exact-target adapter builds can be injected without mutating this host", async (t) => {
  const crossRoot = path.join(repositoryRoot, "tmp/task-8-native-cross-build");
  await fs.rm(crossRoot, { recursive: true, force: true });
  t.after(() => fs.rm(crossRoot, { recursive: true, force: true }));

  const linux = await buildNativeAdapter({
    platform: "linux",
    arch: "x64",
    outputDirectory: path.join(crossRoot, "linux"),
    buildLinux: async ({ executable }) => {
      await fs.writeFile(executable, "test Linux notification helper\n");
    },
  });
  const linuxTarget = path.join(linux.outputDirectory, "linux-x64");
  assert.deepEqual((await fs.readdir(linuxTarget)).sort(), ["localapp-native-ipc-client.mjs", "localapp-notifications"]);
  const linuxClient = await fs.readFile(path.join(linuxTarget, "localapp-native-ipc-client.mjs"), "utf8");
  assert.equal(linuxClient.includes(process.execPath), false);
  assert.equal(linuxClient.includes(linux.outputDirectory), false);

  const windows = await buildNativeAdapter({
    platform: "win32",
    arch: "x64",
    outputDirectory: path.join(crossRoot, "windows"),
    buildWindows: async ({ executable }) => {
      await fs.mkdir(path.dirname(executable), { recursive: true });
      await fs.writeFile(executable, "test Windows helper\n");
    },
  });
  const manifest = JSON.parse(await fs.readFile(path.join(windows.outputDirectory, "adapter-manifest.json"), "utf8"));
  assert.equal(manifest.target, "win32-x64");
  assert.deepEqual((await fs.readdir(windows.outputDirectory)).sort(), ["adapter-manifest.json", "win32-x64"]);
  assert.equal(manifest.assets.some((asset) => asset.path === "win32-x64/localapp-native.exe"), true);
  assert.equal(manifest.assets.some((asset) => asset.path.includes("tauri") || asset.path.includes("electron")), false);

  const otherMacArchitecture = process.arch === "arm64" ? "x64" : "arm64";
  await assert.rejects(
    buildNativeAdapter({ platform: "darwin", arch: otherMacArchitecture, outputDirectory: path.join(crossRoot, "wrong-mac-arch") }),
    /cannot build darwin-.* on this host/i,
  );
});

test("Windows helper preserves argv, has an explicit application path, and keeps browser opening outside Job ownership", async () => {
  const source = await fs.readFile(path.join(repositoryRoot, "packages/localapp/native/windows/src/main.rs"), "utf8");
  assert.doesNotMatch(source, /collect::<Vec<_>>\(\)\.join\(" "\)/);
  assert.match(source, /CreateProcessW\(application_name\.as_ptr\(\)/);
  assert.match(source, /RegCreateKeyExW\(HKEY_CURRENT_USER/);
  assert.match(source, /url\.as_bytes\(\)\.len\(\) > MAX_ACTIVATION_URL_BYTES/);
  assert.ok(source.indexOf("url.as_bytes().len() > MAX_ACTIVATION_URL_BYTES") < source.indexOf("Command::new"));
  assert.match(source, /--scheme/);
  assert.match(source, /ShellExecuteW/);
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
