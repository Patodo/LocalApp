import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { preparePublicSkills, PUBLIC_AGENT_SKILLS } from "../public-agent-skills.js";
it("installs only selected public skill bundles and removes disabled bundles", () => {
  const root = path.resolve(__dirname, "../../../../../tmp/public-skills-test", String(process.pid));
  fs.mkdirSync(root, { recursive: true });
  try {
    const destination = preparePublicSkills(root, ["pdf", "docx"]);
    expect(fs.readdirSync(destination)).toEqual(["docx", "pdf"]);
    for (const skill of PUBLIC_AGENT_SKILLS) {
      preparePublicSkills(root, [skill.id]);
      const directory = path.join(destination, skill.id);
      expect(fs.readFileSync(path.join(directory, "SKILL.md"), "utf8")).toContain("LocalApp usage");
      expect(fs.readFileSync(path.join(directory, "LICENSE"), "utf8")).toContain("MIT License");
      expect(JSON.parse(fs.readFileSync(path.join(directory, "SOURCE.json"), "utf8")).commit).toMatch(/^[0-9a-f]{40}$/);
    }
    preparePublicSkills(root, []);
    expect(fs.readdirSync(destination)).toEqual([]);
    expect(() => preparePublicSkills(root, ["../secret"])).toThrow("Unknown public skill");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
