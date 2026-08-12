import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillsDir = path.resolve(process.cwd(), ".claude", "skills");
const repoRoot = path.resolve(process.cwd(), "..");

function readSkill(name: string): string {
  return fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
}

describe("LocalApp skill documentation consistency", () => {
  it("recommends count APIs instead of list(limit: 1) as normal application code", () => {
    const dataSkill = readSkill("localapp-data");
    expect(dataSkill).toContain("useCount");
    expect(dataSkill).toContain("client.count()");
    expect(dataSkill).toContain("不要把 `list({ limit: 1 })` / `list(limit: 1)` 当作常规计数写法");
  });

  it("documents content upload separately from the deployment compatibility transport", () => {
    const uploadSkill = readSkill("localapp-upload");
    expect(uploadSkill).toContain("useUpload()");
    expect(uploadSkill).toContain("/api/content/upload");
    expect(uploadSkill).toContain("/serve/<owner>/<app>/api/content/<key>");
    expect(uploadSkill).not.toContain("返回的 `url` 指向 `/api/content/{key}`");
    expect(uploadSkill).toContain("应用代码不得调用 `/api/upload`");
    expect(uploadSkill).toContain("部署兼容传输");
    expect(uploadSkill).toContain("不是第二套安装实现");
    expect(uploadSkill).not.toContain("已整体移除");
  });

  it("does not recommend removed schema CLI commands in app-building skills", () => {
    const skillFiles = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skillsDir, entry.name, "SKILL.md"))
      .filter((file) => fs.existsSync(file));

    for (const file of skillFiles) {
      const content = fs.readFileSync(file, "utf8");
      expect(content, file).not.toMatch(/localapp\s+schemas\s+create/);
    }
  });

  it("guides production data access to registered named SQL without raw SQL escape hatches", () => {
    const dataSkill = readSkill("localapp-data");
    expect(dataSkill).toContain("client.query(");
    expect(dataSkill).toContain("client.mutate(");
    expect(dataSkill).toContain("backend");
    expect(dataSkill).not.toMatch(/client\.exec\([^)]*sql/i);
    expect(dataSkill).not.toMatch(/await\s+exec\(/);
    expect(dataSkill).toContain("没有 raw SQL 端点");
  });

  it("documents formal PlatformShell route as the uploaded app validation entry", () => {
    const claudeGuide = fs.readFileSync(path.resolve(process.cwd(), "CLAUDE.md"), "utf8");
    expect(claudeGuide).toContain("http://<server-origin>/<userId>/<pageName>/");
    expect(claudeGuide).toContain("raw app resource/API base");
    expect(claudeGuide).toContain("不作为应用功能验收入口");

    const platformLoopRefs = [
      ".agents/skills/localapp-app-loop/references/task-envelope.md",
      ".agents/skills/localapp-app-loop/references/user-validation.md",
    ];
    const availablePlatformLoopRefs = platformLoopRefs.filter((rel) =>
      fs.existsSync(path.join(repoRoot, rel))
    );
    expect([0, platformLoopRefs.length]).toContain(availablePlatformLoopRefs.length);
    for (const rel of availablePlatformLoopRefs) {
      const content = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(content, rel).toContain("PlatformShell");
      expect(content, rel).not.toMatch(/Verify\s+\/serve\/<owner>\/<app>\/\./);
      expect(content, rel).not.toContain("deployed `/serve/{owner}/{app}/` app");
    }
  });
});
