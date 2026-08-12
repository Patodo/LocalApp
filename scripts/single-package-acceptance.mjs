import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceRoot = path.join(repositoryRoot, "tmp", "single-package-acceptance");
const npmPrefix = path.join(acceptanceRoot, "npm-prefix");
const statePath = path.join(acceptanceRoot, "state.json");
const cliPath = path.join(npmPrefix, "node_modules", ".bin", process.platform === "win32" ? "localapp.cmd" : "localapp");

const command = process.argv[2] ?? "start";
if (command === "start") await start();
else if (command === "stop") await stop();
else if (command === "status") process.stdout.write(await fs.readFile(statePath, "utf8"));
else throw new Error(`Unknown acceptance command: ${command}`);

async function start() {
  await stop().catch(() => undefined);
  await fs.rm(acceptanceRoot, { recursive: true, force: true });
  await fs.mkdir(acceptanceRoot, { recursive: true, mode: 0o700 });
  await run("npm", ["run", "package:localapp"], repositoryRoot);
  const tarballs = (await fs.readdir(path.join(repositoryRoot, "tmp/localapp-package")))
    .filter((name) => /^localapp-[0-9].*\.tgz$/.test(name));
  if (tarballs.length !== 1) throw new Error("Expected exactly one packed localapp tarball");
  const tarball = path.join(repositoryRoot, "tmp/localapp-package", tarballs[0]);
  await run("npm", ["install", "--prefix", npmPrefix, "--ignore-scripts", tarball], repositoryRoot);

  const environment = acceptanceEnvironment();
  let lifecycle;
  let lifecycleOutput = "";
  let serviceMode = "user-service";
  try {
    const started = await run(cliPath, ["server", "start"], repositoryRoot, environment, 90_000);
    lifecycleOutput = started.stdout;
    lifecycle = lastJson(started.stdout);
  } catch (error) {
    if (process.platform !== "darwin" || !repositoryRoot.startsWith("/Volumes/")) throw error;
    serviceMode = "external-volume-daemon";
    const registration = path.join(environment.HOME, "Library/LaunchAgents/com.localapp.daemon.plist");
    await run("launchctl", ["bootout", `gui/${process.getuid()}`, registration], repositoryRoot, environment).catch(() => undefined);
    const daemonLog = path.join(acceptanceRoot, "daemon-foreground.log");
    const logHandle = await fs.open(daemonLog, "a", 0o600);
    const child = spawn(cliPath, ["_daemon"], {
      cwd: repositoryRoot,
      env: environment,
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    });
    child.unref();
    await logHandle.close();
    lifecycle = await waitForLifecycle(environment);
    lifecycleOutput = JSON.stringify(lifecycle);
  }
  const server = lifecycle?.status?.server;
  if (server?.status !== "ready" || typeof server.listenUrl !== "string" || typeof server.setupUrl !== "string") {
    throw new Error(`Packed daemon did not expose clean-state readiness: ${lifecycleOutput}`);
  }

  const initialized = await fetch(`${server.setupUrl.split("/setup?")[0]}/api/setup/initialize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: new URL(server.setupUrl).searchParams.get("token"), username: "localadmin", password: "localadmin" }),
  });
  if (initialized.status !== 201) throw new Error(`First-run initialization failed: ${await initialized.text()}`);
  const session = await login(server.listenUrl);
  const createdKey = await fetch(`${server.listenUrl}/api/keys`, {
    method: "POST",
    headers: { cookie: session, "content-type": "application/json" },
    body: "{}",
  });
  const keyEnvelope = await createdKey.json();
  if (!createdKey.ok || keyEnvelope?.success !== true || typeof keyEnvelope.data?.key !== "string") {
    throw new Error("Acceptance API key creation failed");
  }
  const apiKey = keyEnvelope.data.key;
  await run(cliPath, ["login", server.listenUrl, "--api-key", apiKey, "--profile", "local"], repositoryRoot, environment);

  const buildEnvironment = { ...environment, VITE_LOCALAPP_ACCEPTANCE_ROOT: path.join(acceptanceRoot, "installed-skills") };
  for (const name of ["skill-market", "resume-manager"]) {
    const project = path.join(repositoryRoot, "examples", name);
    await run("pnpm", ["-C", project, "build"], repositoryRoot, buildEnvironment, 120_000);
    await run(cliPath, ["check", "--json"], project, environment, 60_000);
    await fs.rm(path.join(project, `${name}.localapp`), { force: true });
    await run(cliPath, ["app", "install", "--target", "local"], project, environment, 120_000);
    const response = await fetch(`${server.listenUrl}/localadmin/${name}/`, { headers: { cookie: session } });
    if (!response.ok || !(await response.text()).includes("data-localapp-app-resource-base")) {
      throw new Error(`${name} formal application route failed`);
    }
  }

  const state = {
    schemaVersion: 1,
    package: tarball,
    cli: cliPath,
    supportDir: environment.LOCALAPP_SUPPORT_DIR,
    runtimeDir: environment.LOCALAPP_RUNTIME_DIR,
    dataDir: environment.LOCALAPP_DATA_DIR,
    serverUrl: server.listenUrl,
    setupUrl: server.setupUrl,
    username: "localadmin",
    password: "localadmin",
    apiKey,
    applications: {
      skillMarket: `${server.listenUrl}/localadmin/skill-market/`,
      resumeManager: `${server.listenUrl}/localadmin/resume-manager/`,
    },
    installedSkills: path.join(acceptanceRoot, "installed-skills"),
    downloads: path.join(acceptanceRoot, "downloads"),
    serviceMode,
  };
  await fs.mkdir(state.downloads, { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ success: true, serverUrl: state.serverUrl, applications: state.applications })}\n`);
}

async function stop() {
  const existing = await readJson(statePath).catch(() => undefined);
  const executable = typeof existing?.cli === "string" ? existing.cli : cliPath;
  if (await fs.stat(executable).then((entry) => entry.isFile(), () => false)) {
    await run(executable, ["server", "uninstall"], repositoryRoot, acceptanceEnvironment(existing), 60_000).catch(() => undefined);
  }
  process.stdout.write(`${JSON.stringify({ success: true, stopped: true })}\n`);
}

function acceptanceEnvironment(state) {
  return {
    ...process.env,
    HOME: path.join(acceptanceRoot, "home"),
    LOCALAPP_CONFIG_DIR: path.join(acceptanceRoot, "config"),
    LOCALAPP_SUPPORT_DIR: typeof state?.supportDir === "string" ? state.supportDir : path.join(acceptanceRoot, "support"),
    LOCALAPP_RUNTIME_DIR: typeof state?.runtimeDir === "string" ? state.runtimeDir : path.join(acceptanceRoot, "runtime"),
    LOCALAPP_DATA_DIR: typeof state?.dataDir === "string" ? state.dataDir : path.join(acceptanceRoot, "server"),
  };
}

async function login(serverUrl) {
  const response = await fetch(`${serverUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "localadmin", password: "localadmin" }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!response.ok || !cookie) throw new Error(`Acceptance login failed: ${await response.text()}`);
  return cookie;
}

async function waitForLifecycle(environment) {
  let lastError;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const result = await run(cliPath, ["server", "status"], repositoryRoot, environment, 10_000);
      const lifecycle = lastJson(result.stdout);
      if (lifecycle?.status?.server?.status === "ready") return lifecycle;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error("Packed daemon did not become ready");
}

async function run(executable, args, cwd, env = process.env, timeout = 180_000) {
  try {
    return await execute(executable, args, { cwd, env, timeout, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    const sensitive = sensitiveArgumentValues(args);
    const stderr = redactText(typeof error?.stderr === "string" ? error.stderr : "", sensitive);
    const stdout = redactText(typeof error?.stdout === "string" ? error.stdout : "", sensitive);
    throw new Error(`${path.basename(executable)} ${redactCommandArguments(args).join(" ")} failed\n${stdout}\n${stderr}`);
  }
}

function redactCommandArguments(args) {
  return args.map((argument, index) => index > 0 && args[index - 1] === "--api-key" ? "[REDACTED]" : argument);
}

function sensitiveArgumentValues(args) {
  return args.flatMap((argument, index) => index > 0 && args[index - 1] === "--api-key" ? [argument] : []);
}

function redactText(value, sensitive) {
  return sensitive.reduce((output, secret) => secret.length === 0 ? output : output.replaceAll(secret, "[REDACTED]"), value);
}

function lastJson(output) {
  for (const line of output.trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line); } catch { /* continue */ }
  }
  return undefined;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
