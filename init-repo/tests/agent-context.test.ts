import { describe, it, expect } from "vitest";
import { buildSystemContext, buildSystemPrompt } from "@localapp/sdk-agent";

describe("buildSystemContext", () => {
  it("已登录用户包含用户名", () => {
    const result = buildSystemContext({ name: "testuser" }, null);
    expect(result).toContain("当前用户: testuser");
  });

  it("未登录用户显示'未登录'", () => {
    const result = buildSystemContext(null, null);
    expect(result).toContain("当前用户: 未登录");
  });

  it("有应用名称时包含应用名称行", () => {
    const result = buildSystemContext(null, "leave-form");
    expect(result).toContain("当前应用: leave-form");
  });

  it("无应用名称时不包含应用名称行", () => {
    const result = buildSystemContext(null, null);
    expect(result).not.toContain("当前应用:");
  });

  it("包含工具使用规则", () => {
    const result = buildSystemContext(null, null);
    expect(result).toContain("## 工具使用规则");
    expect(result).toContain("必须调用工具执行");
    expect(result).toContain("信息不完整时");
  });

  it("应用名称在用户名称之前", () => {
    const result = buildSystemContext({ name: "testuser" }, "myapp");
    const appIdx = result.indexOf("当前应用:");
    const userIdx = result.indexOf("当前用户:");
    expect(appIdx).toBeLessThan(userIdx);
  });
});

describe("buildSystemPrompt", () => {
  it("三层拼接顺序：系统层 → 数据层 → 应用层", () => {
    const result = buildSystemPrompt("系统层", "数据层", "应用层");
    const sysIdx = result.indexOf("系统层");
    const dataIdx = result.indexOf("数据层");
    const hintIdx = result.indexOf("应用层");
    expect(sysIdx).toBeLessThan(dataIdx);
    expect(dataIdx).toBeLessThan(hintIdx);
  });

  it("空 schema context 时跳过数据层", () => {
    const result = buildSystemPrompt("系统层", "", "应用层");
    expect(result).toBe("系统层\n\n应用层");
  });

  it("无 hint 时跳过应用层", () => {
    const result = buildSystemPrompt("系统层", "数据层");
    expect(result).toBe("系统层\n\n数据层");
  });

  it("仅系统层时无多余空行", () => {
    const result = buildSystemPrompt("系统层", "");
    expect(result).toBe("系统层");
  });

  it("空字符串 hint 等同于无 hint", () => {
    const result = buildSystemPrompt("系统层", "数据层", "");
    expect(result).toBe("系统层\n\n数据层");
  });
});
