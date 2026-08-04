import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

function readTemplateFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

describe("business modeling template guidance", () => {
  it("CLAUDE.md 列出业务应用建模 skill 入口", () => {
    const claude = readTemplateFile("CLAUDE.md");
    expect(claude).toContain("业务");
    expect(claude).toMatch(/业务应用建模|business-app-model|业务建模/);
    expect(claude).toContain(".claude/skills/localapp-business");
  });

  it(".claude/skills/ 包含业务应用建模 skill 文件", () => {
    const skillPath = path.join(root, ".claude", "skills", "localapp-business", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    const skill = fs.readFileSync(skillPath, "utf-8");
    expect(skill).toContain("name: localapp-business");
    expect(skill).toContain("申请类");
    expect(skill).toContain("审批类");
    expect(skill).toContain("分配类");
    expect(skill).toContain("目录类");
    expect(skill).toContain("ownerField");
    expect(skill).toContain("statusField");
    expect(skill).toContain("recordAccess");
  });

  it("localapp-data skill 包含业务模型与记录级权限说明", () => {
    const dataSkill = readTemplateFile(".claude/skills/localapp-data/SKILL.md");
    expect(dataSkill).toContain("business");
    expect(dataSkill).toContain("defaultFrom");
    expect(dataSkill).toContain("enum");
    expect(dataSkill).toContain("recordAccess");
    expect(dataSkill).toContain("ownerField");
  });

  it("localapp-auth skill 包含 usePermissions / <Can> 用法", () => {
    const authSkill = readTemplateFile(".claude/skills/localapp-auth/SKILL.md");
    expect(authSkill).toContain("usePermissions");
    expect(authSkill).toContain("<Can");
  });
});

describe("default App.tsx 业务模型示例", () => {
  it("示例包含当前用户归属的业务字段", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toMatch(/created_by|ownerId|assigneeId|owner_field|createdBy/);
  });

  it("示例包含状态字段", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toMatch(/status|state/);
  });

  it("示例展示 usePermissions 或 <Can> 权限 UI 模式", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toMatch(/usePermissions|<Can/);
  });

  it("示例从 @localapp/sdk-react 导入 usePermissions 或 Can", () => {
    const app = readTemplateFile(path.join("src", "App.tsx"));
    expect(app).toMatch(/from ["']@localapp\/sdk-react["']/);
    expect(app).toMatch(/usePermissions|\bCan\b/);
  });
});
