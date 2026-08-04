import { describe, it, expect } from "vitest";
import { convertMessages } from "@localapp/sdk-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

describe("assistant-ui-adapter > convertMessages", () => {
  it("转换空消息数组", () => {
    expect(convertMessages([])).toEqual([]);
  });

  it("转换用户文本消息", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "你好", timestamp: Date.now() },
    ];
    const result = convertMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("你好");
  });

  it("转换用户消息（数组 content）", () => {
    const msgs: AgentMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
  });

  it("转换助手文本消息", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "好的" }],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "stop",
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    const parts = result[0].content as any[];
    expect(parts[0]).toEqual({ type: "text", text: "好的" });
  });

  it("转换助手消息中的工具调用", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "我来填写" },
          {
            type: "toolCall",
            id: "call_1",
            name: "fillForm",
            arguments: { field: "name", value: "张三" },
          },
        ],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    const parts = result[0].content as any[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "我来填写" });
    expect(parts[1].type).toBe("tool-call");
    expect(parts[1].toolCallId).toBe("call_1");
    expect(parts[1].toolName).toBe("fillForm");
    expect(parts[1].args).toEqual({ field: "name", value: "张三" });
    expect(parts[1].argsText).toBe('{"field":"name","value":"张三"}');
  });

  it("将 ToolResultMessage 合并回 assistant 消息的 tool-call part", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "fillForm",
            arguments: { field: "name" },
          },
        ],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "fillForm",
        content: [{ type: "text", text: '"已填写 name"' }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    // tool result should NOT produce a separate message
    expect(result).toHaveLength(1);
    const parts = result[0].content as any[];
    expect(parts[0].type).toBe("tool-call");
    expect(parts[0].result).toBe('"已填写 name"');
    expect(parts[0].isError).toBe(false);
  });

  it("多条 tool result 合并到同一条 assistant 消息", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "fillForm", arguments: { field: "name" } },
          { type: "toolCall", id: "c2", name: "fillForm", arguments: { field: "dept" } },
        ],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "fillForm",
        content: [{ type: "text", text: '"已填写 name"' }],
        isError: false,
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "fillForm",
        content: [{ type: "text", text: '"已填写 dept"' }],
        isError: false,
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    expect(result).toHaveLength(1);
    const parts = result[0].content as any[];
    expect(parts[0].result).toBe('"已填写 name"');
    expect(parts[1].result).toBe('"已填写 dept"');
  });

  it("tool result isError 标记正确传递", () => {
    const msgs: AgentMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "submitForm", arguments: {} },
        ],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "submitForm",
        content: [{ type: "text", text: '"缺少必填字段"' }],
        isError: true,
        timestamp: Date.now(),
      },
    ];
    const result = convertMessages(msgs);
    const parts = result[0].content as any[];
    expect(parts[0].result).toBe('"缺少必填字段"');
    expect(parts[0].isError).toBe(true);
  });

  it("完整的对话消息序列转换", () => {
    const msgs: AgentMessage[] = [
      { role: "user", content: "帮我请假", timestamp: 1000 },
      {
        role: "assistant",
        content: [{ type: "text", text: "好的，我来帮你" }],
        api: "openai" as any,
        provider: "openai" as any,
        model: "gpt-4",
        usage: {} as any,
        stopReason: "stop",
        timestamp: 2000,
      },
      { role: "user", content: "谢谢", timestamp: 3000 },
    ];
    const result = convertMessages(msgs);
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
  });
});
