import type { TaskRunner } from "../task-runner.js";
import type { AgentAdapter, AgentCapability, StartAgentInput } from "./types.js";

export class CodexAgent implements AgentAdapter {
  readonly kind = "codex" as const;

  constructor(private readonly taskRunner: TaskRunner, private readonly executablePath: string | null) {
    if (executablePath) taskRunner.setAllowedExecutable(this.kind, executablePath);
  }

  capability(): AgentCapability {
    return { kind: this.kind, executable: "codex", available: this.executablePath !== null, supportsContinuation: false };
  }

  async start(input: Omit<StartAgentInput, "agent">) {
    if (!this.executablePath) throw new Error("codex executable is unavailable");
    return await this.taskRunner.start({
      workspaceId: input.workspaceId,
      kind: "agent",
      executable: this.kind,
      args: ["exec", input.prompt],
      timeoutMs: input.timeoutMs,
      requestedBy: input.requestedBy,
    });
  }

  async send(): Promise<void> {
    throw new Error("codex continuation is unavailable");
  }

  cancel(id: string) { return this.taskRunner.cancel(id); }
  logs(id: string, cursor: number) { return this.taskRunner.logs(id, cursor); }
}

export function parseCodexLog(message: string): { type: "text"; text: string } {
  return { type: "text", text: message };
}
