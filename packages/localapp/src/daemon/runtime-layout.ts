import crypto from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export interface RuntimeLayout {
  platform: NodeJS.Platform;
  supportDir: string;
  dataDir: string;
  releasesDir: string;
  currentManifestPath: string;
  launcherPath: string;
  logsDir: string;
  daemonLogPath: string;
  runtimeDir: string;
  lockPath: string;
  releaseLockPath: string;
  controlEndpoint: string;
}

export interface RuntimeLayoutOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  uid?: number;
  supportDir?: string;
  runtimeDir?: string;
  dataDir?: string;
}

export function createRuntimeLayout(options: RuntimeLayoutOptions = {}): RuntimeLayout {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDir ?? homedir();
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const supportDir = options.supportDir ?? defaultSupportDirectory(platform, env, homeDirectory, pathApi);
  const runtimeDir = options.runtimeDir ?? defaultRuntimeDirectory(platform, env, homeDirectory, supportDir, options.uid, pathApi);
  const dataDir = options.dataDir ?? pathApi.join(supportDir, "data");
  const releasesDir = pathApi.join(supportDir, "releases");
  const controlEndpoint = platform === "win32"
    ? `\\\\.\\pipe\\localapp-${crypto.createHash("sha256").update(supportDir.toLowerCase()).digest("hex").slice(0, 24)}`
    : pathApi.join(runtimeDir, "control.sock");
  return {
    platform,
    supportDir,
    dataDir,
    releasesDir,
    currentManifestPath: pathApi.join(supportDir, "current.json"),
    launcherPath: pathApi.join(supportDir, "bin", "localapp-daemon-bootstrap.mjs"),
    logsDir: pathApi.join(supportDir, "logs"),
    daemonLogPath: pathApi.join(supportDir, "logs", "daemon.log"),
    runtimeDir,
    lockPath: pathApi.join(runtimeDir, "daemon.lock"),
    releaseLockPath: pathApi.join(runtimeDir, "release.lock"),
    controlEndpoint,
  };
}

function defaultSupportDirectory(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDirectory: string,
  pathApi: typeof path.posix | typeof path.win32,
): string {
  if (platform === "darwin") return pathApi.join(homeDirectory, "Library", "Application Support", "LocalApp");
  if (platform === "win32") {
    return pathApi.join(env.LOCALAPPDATA ?? pathApi.join(homeDirectory, "AppData", "Local"), "LocalApp");
  }
  return pathApi.join(env.XDG_DATA_HOME ?? pathApi.join(homeDirectory, ".local", "share"), "localapp");
}

function defaultRuntimeDirectory(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDirectory: string,
  supportDirectory: string,
  uid: number | undefined,
  pathApi: typeof path.posix | typeof path.win32,
): string {
  if (platform === "win32") return pathApi.join(supportDirectory, "run");
  if (platform === "linux") {
    return env.XDG_RUNTIME_DIR
      ? pathApi.join(env.XDG_RUNTIME_DIR, "localapp")
      : pathApi.join(homeDirectory, ".cache", "localapp", "run");
  }
  if (env.TMPDIR) return pathApi.join(env.TMPDIR, `localapp-${uid ?? "user"}`);
  return pathApi.join(homeDirectory, "Library", "Caches", "LocalApp", "run");
}
