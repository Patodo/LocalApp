import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { executeDeviceAction } from "../src/lib/device-action-executor.js";

const fixtureRoot = path.resolve(process.cwd(), "../../tmp/device-action-executor");

describe("device action executor", () => {
  it("runs a generic action with only the declared filesystem permission", async () => {
    const root = path.join(fixtureRoot, "declared-write");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    const output = path.join(root, "output.txt");
    try {
      const result = await executeDeviceAction({
        id: "11111111-1111-4111-8111-111111111111",
        script: "await import('node:fs/promises').then(({writeFile}) => writeFile(input.path, input.value)); return { ok: true };",
        input: { path: output, value: "fixture" },
        permissions: { filesystemWrite: [root] },
        timeoutSeconds: 10,
        workingDirectory: root,
        dataDirectory: root,
      });
      expect(result).toEqual({ ok: true });
      expect(await fs.readFile(output, "utf8")).toBe("fixture");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a write outside the declared permission", async () => {
    const root = path.join(fixtureRoot, "undeclared-write");
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
    try {
      await expect(executeDeviceAction({
        id: "22222222-2222-4222-8222-222222222222",
        script: "await import('node:fs/promises').then(({writeFile}) => writeFile(input.path, 'blocked'));",
        input: { path: path.join(root, "blocked.txt") },
        permissions: {},
        timeoutSeconds: 10,
        workingDirectory: root,
        dataDirectory: root,
      })).rejects.toMatchObject({ code: "DEVICE_ACTION_PERMISSION_DENIED" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
