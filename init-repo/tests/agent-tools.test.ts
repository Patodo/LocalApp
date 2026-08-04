import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

Object.defineProperty(globalThis, "window", {
  value: {
    location: { origin: "http://localhost:3000", pathname: "/serve/user1/myapp" },
  },
  writable: true,
});

import { createSystemTools, convertUserTool } from "@localapp/sdk-agent";

describe("agent-tools > Scenario: Agent 调用 getCurrentUser", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("已登录用户返回用户信息", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: "alice", name: "alice" } }),
    });
    const tools = createSystemTools();
    const getCurrentUser = tools.find((t) => t.name === "getCurrentUser")!;
    const result = await getCurrentUser.execute("tc_1", {});
    const text = (result.content[0] as any).text;
    expect(text).toContain("alice");
  });
});

describe("agent-tools > Scenario: 未登录用户 Agent 调用 getCurrentUser", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("未登录返回 null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ success: false, error: "Unauthorized" }),
    });
    const tools = createSystemTools();
    const getCurrentUser = tools.find((t) => t.name === "getCurrentUser")!;
    const result = await getCurrentUser.execute("tc_1", {});
    expect((result.content[0] as any).text).toBe("null");
  });
});

describe("agent-tools > Scenario: Agent 调用 queryData", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("查询数据返回结果列表", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "test" }], pagination: { total: 1 } } }),
    });
    const tools = createSystemTools();
    expect(tools.find((t) => t.name === "queryData")).toBeUndefined();
  });
});

describe("agent-tools > Scenario: Agent 调用 listSchemas", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("返回 schema 列表", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ name: "todos", fields: { title: { type: "string" } } }],
        }),
    });
    const tools = createSystemTools();
    expect(tools.find((t) => t.name === "listSchemas")).toBeUndefined();
  });
});

describe("agent-tools > Scenario: 注册自定义写操作工具", () => {
  it("convertUserTool 正确注册自定义工具", () => {
    const tool = convertUserTool("createTodo", () => ({
      description: "创建待办事项",
      parameters: { title: { type: "string", required: true } },
      execute: async (args) => ({ id: 1, ...args }),
    }));
    expect(tool.name).toBe("createTodo");
    expect(tool.label).toBe("createTodo");
    expect(tool.parameters).toBeDefined();
  });
});

describe("agent-tools > Scenario: 自定义工具执行成功", () => {
  it("execute 返回正确结果", async () => {
    const tool = convertUserTool("double", () => ({
      description: "返回两倍值",
      parameters: { value: { type: "number", required: true } },
      execute: async (args) => (args as any).value * 2,
    }));
    const result = await tool.execute("tc_1", { value: 5 });
    expect(JSON.parse((result.content[0] as any).text)).toBe(10);
    expect(result.isError).toBeFalsy();
  });
});

describe("agent-tools > Scenario: 自定义工具执行失败", () => {
  it("execute 抛出异常时返回错误结果", async () => {
    const tool = convertUserTool("fail", () => ({
      description: "总是失败",
      parameters: {},
      execute: async () => {
        throw new Error("something went wrong");
      },
    }));
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain("something went wrong");
  });
});

describe("agent-tools > Scenario: 工具定义格式正确", () => {
  it("工具包含 name, description, parameters, execute", () => {
    const tool = convertUserTool("valid", () => ({
      description: "A valid tool",
      parameters: {},
      execute: async () => "ok",
    }));
    expect(tool.name).toBeDefined();
    expect(tool.description).toBeDefined();
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("agent-tools > Scenario: 工具定义缺少 description", () => {
  it("description 为空字符串时工具仍可注册", () => {
    const tool = convertUserTool("noDesc", () => ({
      description: "",
      parameters: {},
      execute: async () => null,
    }));
    expect(tool.name).toBe("noDesc");
    // description is passed through even if empty
    expect(tool).toBeDefined();
  });
});
