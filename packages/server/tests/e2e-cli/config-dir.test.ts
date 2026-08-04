import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { buildCli, createCliTestEnv, runCli, cliEnvVars, type CliTestEnv } from "./helpers.js";

const execFile = promisify(execFileCb);

const CLI_BIN = path.resolve(
  import.meta.dirname,
  `../../../../packages/cli/target/debug/localapp${process.platform === "win32" ? ".exe" : ""}`,
);

describe("LOCALAPP_CONFIG_DIR", () => {
  let env: CliTestEnv;
  let configDir: string;

  beforeAll(async () => {
    await buildCli();
    env = await createCliTestEnv();

    configDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-cli-config-"));
    const config = { server_url: env.baseUrl, api_key: env.apiKey };
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify(config, null, 2));
  });

  afterAll(async () => {
    await env.cleanup();
    await fs.promises.rm(configDir, { recursive: true, force: true });
  });

  async function runRealCli(args: string[], extraEnv?: Record<string, string>) {
    const envVars: Record<string, string> = {
      PATH: process.env.PATH || "",
      HOME: process.env.HOME || "",
      USERPROFILE: process.env.USERPROFILE || "",
      SYSTEMROOT: process.env.SYSTEMROOT || "",
      ...extraEnv,
    };
    try {
      const { stdout, stderr } = await execFile(CLI_BIN, args, {
        env: envVars,
        timeout: 30_000,
      });
      return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: any) {
      return {
        exitCode: typeof err.code === "number" ? err.code : 1,
        stdout: (err.stdout ?? "").toString().trim(),
        stderr: (err.stderr ?? "").toString().trim(),
      };
    }
  }

  it("reads config from LOCALAPP_CONFIG_DIR directory", async () => {
    const result = await runRealCli(["pages", "list"], {
      LOCALAPP_CONFIG_DIR: configDir,
    });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
  });

  it("falls back to env vars when LOCALAPP_CONFIG_DIR is not set", async () => {
    const result = await runCli(["pages", "list"], {
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
  });

  it("fails gracefully when LOCALAPP_CONFIG_DIR points to non-existent dir", async () => {
    const result = await runRealCli(["pages", "list"], {
      LOCALAPP_CONFIG_DIR: "/nonexistent/path/that/does/not/exist",
    });
    expect(result.exitCode).not.toBe(0);
  });
});
