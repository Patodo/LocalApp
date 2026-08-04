import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import {
  createLocalRuntime,
  type LocalAppRegistration,
  type LocalRuntime,
  type LocalRuntimeOptions,
} from "./index.js";

const REGISTRY_SCHEMA_VERSION = 1;
const LOOPBACK_HOST = "127.0.0.1";

export interface LocalRuntimeProcessOptions
  extends Omit<LocalRuntimeOptions, "apps"> {
  apps: LocalAppRegistration[];
  port?: number;
}

export interface LocalRuntimeProcess {
  runtime: LocalRuntime;
  host: typeof LOOPBACK_HOST;
  port: number;
  close(): Promise<void>;
}

export function loadLocalAppRegistry(
  registryPath: string,
): LocalAppRegistration[] {
  const absolutePath = path.resolve(registryPath);
  const document = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as unknown;
  if (!isRecord(document) || document.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new Error("Unsupported local app registry schema");
  }
  if (!Array.isArray(document.apps)) {
    throw new Error("Local app registry must contain an apps array");
  }
  return document.apps.map((entry, index) =>
    parseRegistration(entry, index, path.dirname(absolutePath)),
  );
}

export async function startLocalRuntime(
  options: LocalRuntimeProcessOptions,
): Promise<LocalRuntimeProcess> {
  const runtime = await createLocalRuntime(options);
  try {
    await runtime.listen({
      host: LOOPBACK_HOST,
      port: options.port ?? 0,
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  const address = runtime.server.address();
  if (!address || typeof address === "string") {
    await runtime.close();
    throw new Error("Local Runtime did not expose a TCP address");
  }
  return createProcessHandle(runtime, address);
}

function createProcessHandle(
  runtime: LocalRuntime,
  address: AddressInfo,
): LocalRuntimeProcess {
  let closed = false;
  return {
    runtime,
    host: LOOPBACK_HOST,
    port: address.port,
    async close() {
      if (closed) return;
      closed = true;
      await runtime.close();
    },
  };
}

function parseRegistration(
  value: unknown,
  index: number,
  registryRoot: string,
): LocalAppRegistration {
  if (!isRecord(value)) {
    throw new Error(`Invalid local app registry entry at index ${index}`);
  }
  const id = requireString(value.id, "id", index);
  const version = requireString(value.version, "version", index);
  const versionRoot = resolveRegistryPath(
    requireString(value.versionRoot, "versionRoot", index),
    registryRoot,
  );
  const dataRoot = resolveRegistryPath(
    requireString(value.dataRoot, "dataRoot", index),
    registryRoot,
  );
  return { id, version, versionRoot, dataRoot };
}

function resolveRegistryPath(value: string, registryRoot: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(registryRoot, value);
}

function requireString(
  value: unknown,
  field: string,
  index: number,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Local app registry entry ${index} has invalid ${field}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
