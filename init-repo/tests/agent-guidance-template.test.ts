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
    expect(guidance).toContain("tmp/localapp-schema/schema.db");
    expect(guidance).not.toContain(".localapp/dev.db");
    expect(guidance).not.toMatch(/(^|[\s`"'(])\/tmp\//m);
  });

  it("separates runtime reset from offline seeds and documents PDF upload", () => {
    const guidance = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(guidance).toContain("运行时 reset 只重新应用当前已安装版本的 migrations");
    expect(guidance).toContain("db/seeds/dev.sql` 仅供应用自己的离线测试工具显式使用");
    expect(guidance).toContain("当前 `localapp` CLI 不提供数据库 reset 命令");
    expect(guidance).toContain("png/jpg/jpeg/gif/webp/svg/pdf");
    expect(guidance).toContain("应用包安装前拉取生产快照");
  });

  it("ships a standalone generic Device Action skill", () => {
    const skillPath = path.join(root, ".claude/skills/localapp-device-actions/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const skill = fs.readFileSync(skillPath, "utf8");
    expect(skill).toContain("device.run");
    expect(skill).toContain("filesystemWrite");
    expect(skill).not.toMatch(/SKILL market|skill market|installSkill/i);
  });

  it("ships CRDT collaboration and editing-overlay guidance", () => {
    const guidance = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
    const skillPath = path.join(root, ".claude/skills/localapp-collaboration/SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    const skill = fs.readFileSync(skillPath, "utf8");
    expect(guidance).toContain("@localapp/crdt");
    expect(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8")).toContain("localapp-collaboration/SKILL.md");
    expect(skill).toContain("data-localapp-edit-surface");
    expect(skill).toContain("data-localapp-edit-field");
    expect(skill).toContain("editing-awareness-overlay");
    expect(skill).toContain("pointer-events: none");
    expect(skill).toContain("不要创建应用私有 WebSocket Server");
  });

  it("distinguishes application content upload from deployment compatibility transport", () => {
    const uploadSkill = fs.readFileSync(
      path.join(root, ".claude/skills/localapp-upload/SKILL.md"),
      "utf8",
    );
    expect(uploadSkill).toContain("/api/content/upload");
    expect(uploadSkill).toContain("/serve/<owner>/<app>/api/content/<key>");
    expect(uploadSkill).not.toContain("返回的 `url` 指向 `/api/content/{key}`");
    expect(uploadSkill).toContain("部署兼容传输");
    expect(uploadSkill).toContain("应用代码不得调用 `/api/upload`");
    expect(uploadSkill).not.toContain("`/api/upload` 端点（restrict-app-api-to-named-sql 变更前的 legacy 别名）已整体移除");
  });
});
