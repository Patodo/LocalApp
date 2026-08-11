import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("generated application agent guidance", () => {
  it("uses the unified Server and generic Device Actions", () => {
    const guidance = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    expect(guidance).toContain("device.run");
    expect(guidance).toContain("localapp app install --target");
    expect(guidance).toContain("tmp/");
    expect(guidance).not.toMatch(/MiniServer|Local Runtime|localapp upload|localapp local install/);
    expect(guidance).not.toMatch(/(^|[\s`"'(])\/tmp\//m);
  });

  it("ships a standalone generic Device Action skill", () => {
    const skillPath = path.join(root, ".claude/skills/localapp-device-actions/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const skill = fs.readFileSync(skillPath, "utf8");
    expect(skill).toContain("device.run");
    expect(skill).toContain("filesystemWrite");
    expect(skill).not.toMatch(/SKILL market|skill market|installSkill/i);
  });
});
