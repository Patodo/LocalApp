import { homedir } from "node:os";
import path from "node:path";

export function localAppConfigDirectory(): string {
  const override = process.env.LOCALAPP_CONFIG_DIR?.trim();
  if (override !== undefined && override.length > 0) return override;

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "localapp");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "localapp");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "localapp");
}

export function profilesPath(configDir = localAppConfigDirectory()): string {
  return path.join(configDir, "profiles.json");
}
