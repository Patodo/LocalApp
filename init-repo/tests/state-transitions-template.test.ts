import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function readTemplateFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("state transitions template guidance", () => {
  it("CLAUDE.md 列出状态流转 skill 入口", () => {
    const claude = readTemplateFile("CLAUDE.md");
    expect(claude).toMatch(/状态流转|state transition|transitions/);
    expect(claude).toContain(".claude/skills/localapp-transitions");
  });

  it(".claude/skills/ 包含状态流转 skill 文件", () => {
    const skillPath = path.join(root, ".claude", "skills", "localapp-transitions", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    const skill = fs.readFileSync(skillPath, "utf-8");
    expect(skill).toContain("name: localapp-transitions");
    expect(skill).toContain("business.transitions");
    expect(skill).toContain("useTransitions");
    expect(skill).toContain("from");
    expect(skill).toContain("to");
  });

  it("localapp-data skill 提示业务状态变化优先使用 transition API", () => {
    const dataSkill = readTemplateFile(".claude/skills/localapp-data/SKILL.md");
    expect(dataSkill).toMatch(/状态变化|状态流转|transition/);
    expect(dataSkill).toMatch(/useTransitions|transition API/);
  });

  it("localapp-business skill 提示用 transition 而非 update 改业务状态", () => {
    const businessSkill = readTemplateFile(".claude/skills/localapp-business/SKILL.md");
    expect(businessSkill).toMatch(/transition|状态流转/);
  });
});

describe("default App.tsx 状态流转示例", () => {
  it("示例使用 useTransitions 而非普通 update 改业务状态", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toContain("useTransitions");
    // 不应再用普通 useUpdate 来改业务状态字段
    expect(app).not.toMatch(/useUpdate.*status/);
  });

  it("示例从 @localapp/sdk-react 导入 useTransitions", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toMatch(/from ["']@localapp\/sdk-react["']/);
    expect(app).toMatch(/useTransitions/);
  });

  it("示例展示可用 transition 按钮和执行后刷新", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    // transitions.map 应当渲染按钮
    expect(app).toMatch(/transitions\.map|transition\(/);
  });
});
