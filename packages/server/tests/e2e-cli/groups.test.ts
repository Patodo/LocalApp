import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCliTestEnv, runCli, cliEnvVars, type CliTestEnv } from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";

describe("cli-groups", () => {
  let env: CliTestEnv;

  beforeAll(async () => {
    env = await createCliTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("should create a group", async () => {
    const result = await runCli(
      ["groups", "create", "test-group", "--description", "A test group"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(0);
    const resp = JSON.parse(result.stdout);
    expect(resp.data.name).toBe("test-group");
    expect(resp.data.description).toBe("A test group");
  });

  it("should list groups", async () => {
    const result = await runCli(["groups", "list"], { env: cliEnvVars(env) });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    const arr = data.data ?? data;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.some((g: any) => g.name === "test-group")).toBe(true);
  });

  it("should add members to a group", async () => {
    // First register a user via API to add as member
    await createTestUser(env.baseUrl, "groupmember", "test123456");

    const result = await runCli(
      ["groups", "members", "test-group", "--add", "groupmember"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(0);
  });

  it("should list group members", async () => {
    const result = await runCli(
      ["groups", "members", "test-group"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(0);
    const members = JSON.parse(result.stdout);
    expect(Array.isArray(members)).toBe(true);
    expect(members.some((m: any) => m.id === "groupmember")).toBe(true);
  });

  it("should remove members from a group", async () => {
    const result = await runCli(
      ["groups", "members", "test-group", "--remove", "groupmember"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(0);
  });

  it("should delete a group", async () => {
    const result = await runCli(
      ["groups", "delete", "test-group"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(0);

    // Verify group is gone
    const listResult = await runCli(["groups", "list"], { env: cliEnvVars(env) });
    const data = JSON.parse(listResult.stdout);
    const arr = data.data ?? data;
    expect(arr.some((g: any) => g.name === "test-group")).toBe(false);
  });

  it("should reject duplicate group name", async () => {
    await runCli(
      ["groups", "create", "dup-group"],
      { env: cliEnvVars(env) },
    );

    const result = await runCli(
      ["groups", "create", "dup-group"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toMatch(/already exists|duplicate/i);
  });

  it("should error when deleting nonexistent group", async () => {
    const result = await runCli(
      ["groups", "delete", "no-such-group"],
      { env: cliEnvVars(env) },
    );
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("not found");
  });
});
