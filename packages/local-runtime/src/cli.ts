#!/usr/bin/env node

import { loadLocalAppRegistry, startLocalRuntime } from "./process.js";

async function main(): Promise<void> {
  const registryPath = requireEnv("LOCALAPP_LOCAL_REGISTRY");
  const controlToken = requireEnv("LOCALAPP_LOCAL_CONTROL_TOKEN");
  const port = parsePort(process.env.LOCALAPP_LOCAL_PORT);
  const apps = loadLocalAppRegistry(registryPath);
  const runtime = await startLocalRuntime({ apps, controlToken, port });

  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      host: runtime.host,
      port: runtime.port,
      pid: process.pid,
    })}\n`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("LOCALAPP_LOCAL_PORT must be an integer between 0 and 65535");
  }
  return port;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
