import { describe, expect, it, afterEach } from "vitest";
import {
  cliEnvVars,
  createCliTestEnv,
  runCli,
  type CliTestEnv,
} from "./helpers.js";

describe("cli-platform", () => {
  let env: CliTestEnv | undefined;

  afterEach(async () => {
    await env?.cleanup();
    env = undefined;
  });

  it("prints platform version compatibility status", async () => {
    env = await createCliTestEnv();

    const result = await runCli(["platform", "version"], {
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toEqual({
      platformVersion: expect.any(String),
      compatible: true,
    });
  });
});
