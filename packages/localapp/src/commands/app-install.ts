import fs from "node:fs/promises";
import path from "node:path";
import { inspectAppPackage } from "@localapp/server/app-package-api";
import type { ProfileStore } from "../config/profile-store.js";
import { lifecycleError } from "../errors.js";
import { LocalAppClient } from "../http/localapp-client.js";
import { buildApplicationPackage } from "../project/package.js";
import { resolveProjectTarget } from "../project/target.js";

export interface InstallApplicationOptions {
  projectDir: string;
  target?: string;
  packagePath?: string;
  profileStore?: Pick<ProfileStore, "resolve">;
}

export interface InstallResult {
  operation: "install";
  package: string;
  target: string;
  serverUrl: string;
  data: unknown;
}

export async function installApplication(options: InstallApplicationOptions): Promise<InstallResult> {
  const projectDir = path.resolve(options.projectDir);
  const target = await resolveProjectTarget({ projectDir, target: options.target, profileStore: options.profileStore });
  const packagePath = options.packagePath === undefined
    ? (await buildApplicationPackage({ projectDir })).path
    : await inspectExplicitPackage(options.packagePath);
  const response = await new LocalAppClient(target).installPackage(packagePath);
  if (!response.ok || !successfulEnvelope(response.body)) {
    throw lifecycleError("application_install_failed", safeResponseMessage(response, target.apiKey, "Application installation failed"));
  }
  return { operation: "install", package: packagePath, target: target.name, serverUrl: target.serverUrl, data: response.body.data };
}

async function inspectExplicitPackage(input: string): Promise<string> {
  let packagePath: string;
  try {
    packagePath = await fs.realpath(input);
  } catch {
    throw lifecycleError("application_package_invalid", "Application package is invalid");
  }
  if (path.extname(packagePath).toLowerCase() !== ".localapp") {
    throw lifecycleError("application_package_invalid", "Application package must use the .localapp extension");
  }
  try {
    await inspectAppPackage(packagePath);
    return packagePath;
  } catch {
    throw lifecycleError("application_package_invalid", "Application package is invalid");
  }
}

function successfulEnvelope(value: unknown): value is { success: true; data: unknown } {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).success === true && "data" in value;
}

function safeResponseMessage(response: { ok: false; error: string } | { ok: true; body: unknown }, credential: string, fallback: string): string {
  const candidate = response.ok
    ? response.body && typeof response.body === "object" && !Array.isArray(response.body)
      ? (response.body as Record<string, unknown>).error ?? (response.body as Record<string, unknown>).message
      : undefined
    : response.error;
  return typeof candidate === "string" && candidate.length > 0 ? candidate.replaceAll(credential, "[REDACTED]") : fallback;
}
