import { isToolCallMessage, postToParent } from "./postmessage-types.js";
import type { ToolResultMessage } from "./postmessage-types.js";
import type { UserToolDef } from "./types.js";

type ExecuteFn = (args: Record<string, unknown>) => Promise<unknown>;

export class PostMessageBridge {
  private tools = new Map<string, ExecuteFn>();
  private handler: (event: MessageEvent) => void;
  private activeCalls = new Map<string, Promise<void>>();

  constructor() {
    this.handler = this.onMessage.bind(this);
    window.addEventListener("message", this.handler);
  }

  registerTool(name: string, execute: ExecuteFn): void {
    this.tools.set(name, execute);
  }

  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  private onMessage(event: MessageEvent): void {
    if (!isToolCallMessage(event.data)) return;

    const { callId, toolName, args } = event.data;
    const execute = this.tools.get(toolName);
    if (!execute) return;

    const promise = this.executeAndRespond(callId, toolName, execute, args);
    this.activeCalls.set(callId, promise);
    promise.finally(() => this.activeCalls.delete(callId));
  }

  private async executeAndRespond(
    callId: string,
    toolName: string,
    execute: ExecuteFn,
    args: Record<string, unknown>,
  ): Promise<void> {
    let result: unknown;
    let isError = false;
    try {
      result = await execute(args);
    } catch (e: unknown) {
      result = e instanceof Error ? e.message : String(e);
      isError = true;
    }
    const msg: ToolResultMessage = { type: "localapp:tool_result", callId, result, isError };
    postToParent(msg);
  }

  destroy(): void {
    window.removeEventListener("message", this.handler);
    this.tools.clear();
    this.activeCalls.clear();
  }
}
