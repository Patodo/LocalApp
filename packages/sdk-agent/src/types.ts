import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";

export interface UserToolDef {
  description: string;
  parameters: {
    [key: string]: {
      type: "string" | "number" | "boolean";
      required?: boolean;
      description?: string;
    };
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface UseAgentOptions {
  tools?: Record<string, UserToolDef>;
  systemHint?: string;
  shellIntegration?: boolean;
}

export interface UseAgentReturn {
  send: (text: string) => void;
  messages: AgentMessage[];
  isRunning: boolean;
  error: string | null;
  chatOpen?: boolean;
}
