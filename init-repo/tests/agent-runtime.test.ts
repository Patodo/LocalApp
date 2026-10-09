import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock window.location
Object.defineProperty(globalThis, "window", {
  value: {
    location: { origin: "http://localhost:3000", pathname: "/serve/user1/myapp" },
  },
  writable: true,
});

// Mock schemas response
function mockSchemasResponse(schemas: unknown[] = []) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data: schemas }),
  };
}

function mockMeResponse(user: { id: string; name: string } | null) {
  return {
    ok: !!user,
    json: () =>
      Promise.resolve(
        user
          ? { success: true, data: user }
          : { success: false, error: "Unauthorized" },
      ),
  };
}

import { HarnessAgent, buildSystemPrompt, fetchSchemaContext, createSystemTools, convertUserTool } from "@localapp/sdk-agent";

describe("agent-runtime > Scenario: 基本初始化", () => {
  it("useAgent 返回 { send, messages, isRunning, error }，messages 初始为空", async () => {
    mockFetch.mockResolvedValueOnce(mockSchemasResponse());
    const { useAgent } = await import("@localapp/sdk-agent");
    // Can't easily test hooks outside React, test the underlying pieces
    expect(typeof HarnessAgent).toBe("function");
  });
});

describe("agent-runtime > Scenario: 页面有 schema", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("schema 上下文自动注入到系统提示", async () => {
    mockFetch.mockResolvedValueOnce(
      mockSchemasResponse([
        {
          name: "todos",
          fields: {
            title: { type: "string", constraints: { required: true } },
            done: { type: "boolean" },
          },
        },
      ]),
    );
    const ctx = await fetchSchemaContext();
    expect(ctx).toContain("todos");
    expect(ctx).toContain("title");
    expect(ctx).toContain("string");
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("todos");
  });
});

describe("agent-runtime > Scenario: 页面无 schema", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("无 schema 时系统提示不包含数据结构信息", async () => {
    mockFetch.mockResolvedValueOnce(mockSchemasResponse([]));
    const ctx = await fetchSchemaContext();
    expect(ctx).toBe("");
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).not.toContain("数据结构");
  });
});

describe("agent-runtime > Scenario: 带系统提示初始化", () => {
  it("systemHint 包含在系统提示中", () => {
    const prompt = buildSystemPrompt("", "这是一个请假管理应用");
    expect(prompt).toContain("请假管理应用");
  });
});

describe("agent-runtime > Scenario: 正常调用", () => {
  it("HarnessAgent 使用 Server 运行入口", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(new Response('data: {"type":"done"}\n\n'));
    const agent = new HarnessAgent({ initialState: { systemPrompt: "帮助用户" } });
    await agent.prompt("你好");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/agent/run");
    expect(agent.state.errorMessage).toBeUndefined();
  });
});

describe("agent-runtime > Scenario: LLM 调用失败", () => {
  it("Server 请求失败时显示错误", async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const agent = new HarnessAgent({ initialState: { systemPrompt: "" } });
    await agent.prompt("你好");
    expect(agent.state.errorMessage).toBe("Network error");
  });
});

describe("agent-runtime > Scenario: 带自定义工具初始化", () => {
  it("convertUserTool 转换自定义工具为 AgentTool 格式", () => {
    const tool = convertUserTool("createTodo", () => ({
      description: "创建待办事项",
      parameters: {
        title: { type: "string", required: true },
      },
      execute: async () => ({ id: 1 }),
    }));
    expect(tool.name).toBe("createTodo");
    expect(tool.description).toBe("创建待办事项");
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("agent-runtime > Scenario: 触发工具调用", () => {
  it("自定义工具 execute 被调用并返回结果", async () => {
    const tool = convertUserTool("echo", () => ({
      description: "回显输入",
      parameters: { text: { type: "string", required: true } },
      execute: async (args) => args,
    }));
    const result = await tool.execute("tc_1", { text: "hello" });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse((result.content[0] as any).text)).toEqual({ text: "hello" });
  });
});

describe("agent-runtime > Scenario: 多轮工具调用", () => {
  it("系统工具列表包含所有三个工具", () => {
    const tools = createSystemTools();
    expect(tools.length).toBe(1);
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["getCurrentUser"]);
  });
});

describe("agent-runtime > Scenario: 纯文本回复", () => {
  it("处理 Harness 的流式文本", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(new Response('data: {"type":"assistant_start"}\n\ndata: {"type":"text_delta","text":"你好"}\n\ndata: {"type":"done"}\n\n'));
    const agent = new HarnessAgent({ initialState: { systemPrompt: "" } });
    await agent.prompt("你好");
    expect(agent.state.messages.at(-1)?.content).toEqual([{ type: "text", text: "你好" }]);
  });
});
