import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { resolve } from "node:path";
import {
  createSkillInstallRequest,
  DEFAULT_INSTALL_ROOT,
  FIXTURE_SKILL_NAME,
} from "../src/device-action";

const testInstallRoot = DEFAULT_INSTALL_ROOT || resolve(process.cwd(), "../../tmp/skill-market-test/installed-skills");

describe("skill market application contract", () => {
  it("does not declare an empty backend contract", () => {
    const manifest = JSON.parse(fs.readFileSync(resolve(process.cwd(), "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.backend).toBeUndefined();
    expect((manifest.requires as Record<string, unknown> | undefined)?.backend).toBeUndefined();
  });

  it("publishes a narrowly scoped local install action", () => {
    const request = createSkillInstallRequest(testInstallRoot);
    expect(request.permissions).toEqual({ filesystemWrite: [testInstallRoot], childProcess: false });
    expect(request.input).toMatchObject({ targetRoot: testInstallRoot, skillName: FIXTURE_SKILL_NAME });
    expect(request.script).toContain("rename(temporary, destination)");
    expect(request.script).toContain("relative(root, destination)");
  });

  it("rejects paths and names outside the bounded input contract", () => {
    expect(() => createSkillInstallRequest("tmp/installed-skills")).toThrow("绝对路径");
    expect(() => createSkillInstallRequest(testInstallRoot, "../escape")).toThrow("格式");
  });
});
