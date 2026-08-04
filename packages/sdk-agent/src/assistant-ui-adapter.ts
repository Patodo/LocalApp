import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ThreadMessageLike } from "@assistant-ui/react";

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
  }
  return "";
}

export function convertMessages(msgs: AgentMessage[]): ThreadMessageLike[] {
  const toolResults = new Map<string, { result: string; isError: boolean }>();

  for (const msg of msgs) {
    if (msg.role === "toolResult") {
      toolResults.set(msg.toolCallId, {
        result: extractText(msg.content),
        isError: msg.isError,
      });
    }
  }

  const result: ThreadMessageLike[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];

    if (msg.role === "user") {
      result.push({
        role: "user",
        content: extractText(msg.content),
        id: `msg-${i}`,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: ThreadMessageLike["content"] extends string
        ? never
        : Array<
            | { type: "text"; text: string }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                args: any;
                argsText: string;
                result?: any;
                isError?: boolean;
              }
          > = [];

      for (const block of msg.content as any[]) {
        if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        }
        if (block.type === "toolCall") {
          const tr = toolResults.get(block.id);
          parts.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: block.name,
            args: block.arguments,
            argsText: JSON.stringify(block.arguments),
            ...(tr ? { result: tr.result, isError: tr.isError } : {}),
          });
        }
      }

      result.push({
        role: "assistant",
        content: parts,
        id: `msg-${i}`,
        status: { type: "complete", reason: "stop" },
      });
      continue;
    }

    // toolResult messages are merged into assistant messages, skip
  }

  return result;
}
