"use client";
import { ConversationProcess } from "./conversation-process";
import { ToolCallRow } from "./tool-call-row";
import { ReasoningBlock } from "./reasoning-block";
import {
  MarkdownText,
  TerminalBlock,
  DiffBlock,
  ReadBlock,
  TextShimmer,
  StateDot,
} from "@deepseek-ai/dsh-client-ui-primitives";
import "./dsh-theme.css";
import userCss from "./upstream/MessageItem.module.css";
import assistantCss from "./upstream/AssistantMarkdown.module.css";
const toolbar = {
  codeLabel: "代码",
  wrapLabel: "自动换行",
  unwrapLabel: "保留列宽",
};
const folding = {
  ...toolbar,
  copy: "复制",
  copied: "已复制",
  collapseAria: "收起",
  collapse: "收起",
  expandAria: (n: number) => `展开 ${n} 行`,
  expand: (n: number) => `展开 ${n} 行`,
};
export const DshMarkdown = ({
  text,
  streaming = false,
  compact = false,
}: {
  text: string;
  streaming?: boolean;
  compact?: boolean;
}) => (
  <MarkdownText
    text={text}
    streaming={streaming}
    variant={compact ? "compact" : "body"}
    labels={{
      code: {
        copyLabel: "复制",
        copiedLabel: "已复制",
        toolbarLabels: toolbar,
      },
      footnotes: "脚注",
    }}
  />
);
export function DshRunningStatus() {
  return <div className="dock-run-status" role="status"><StateDot state="ongoing" size={14} /><TextShimmer active>正在处理…</TextShimmer></div>;
}
export const DshDiff = ({
  changes,
}: {
  changes: Array<{ path: string; before: string | null; after: string | null }>;
}) => (
  <DiffBlock
    diffs={changes.map((c) => ({
      path: c.path,
      oldText: c.before,
      newText: c.after ?? "",
    }))}
    labels={folding}
    maxLines={60}
  />
);
export const DshTerminal = ({
  command,
  output,
  running = false,
}: {
  command: string;
  output: string;
  running?: boolean;
}) => (
  <TerminalBlock
    command={command}
    output={output}
    running={running}
    labels={{
      ...folding,
      signal: (s) => `信号 ${s}`,
      exitCode: (n) => `退出码 ${n}`,
      noExitCode: "已结束",
      running: "运行中",
      failed: "失败",
      done: "已完成",
      noOutput: "暂无输出",
    }}
  />
);
export const DshRead = ({ text, path }: { text: string; path?: string }) => (
  <ReadBlock
    label={path}
    lines={text.split("\n").map((text, i) => ({ number: i + 1, text }))}
    totalLines={text.split("\n").length}
    labels={{ ...folding, window: (n, total) => `${n} / ${total} 行` }}
  />
);
export function DshMessages({ messages, running = false }: { messages: any[]; running?: boolean }) {
  const tools = new Map<string, any>();
  const results = new Map(messages.filter(m => m.role === "toolResult").map(m => [m.toolCallId, m]));
  for (const message of messages)
    for (const block of Array.isArray(message.content) ? message.content : [])
      if (block.type === "toolCall") tools.set(block.id, block);
  const turns: Array<{ user?: any; messages: any[]; key: number }> = [];
  for (const message of messages) {
    if (message.role === "user") turns.push({ user: message, messages: [], key: turns.length });
    else {
      if (!turns.length) turns.push({ messages: [], key: 0 });
      turns[turns.length - 1].messages.push(message);
    }
  }
  return <div className="space-y-4">{turns.map((turn, turnIndex) => {
    const active = running && turnIndex === turns.length - 1;
    const lastAssistant = turn.messages.findLastIndex(message => message.role === "assistant");
    const process: React.ReactNode[] = [];
    const answer: React.ReactNode[] = [];
    turn.messages.forEach((message, index) => {
      if (message.role === "toolResult") {
        if (!tools.has(message.toolCallId)) process.push(<ToolCallRow key={`orphan-${index}`} call={{ name: "工具结果" }} result={message} />);
        return;
      }
      const blocks = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
      const final = index === lastAssistant && !blocks.some((block: any) => block.type === "toolCall");
      blocks.forEach((block: any, blockIndex: number) => {
        const key = `${index}-${blockIndex}`;
        if (block.type === "text") (final ? answer : process).push(<DshMarkdown key={key} text={block.text} />);
        else if (block.type === "reasoning") process.push(<ReasoningBlock key={key} text={block.text} running={active && index === lastAssistant} />);
        else if (block.type === "toolCall") process.push(<ToolCallRow key={key} call={block} result={results.get(block.id)} running={active} />);
      });
    });
    const userText = typeof turn.user?.content === "string" ? turn.user.content : turn.user?.content?.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
    return <div key={turn.key} className="space-y-3">
      {turn.user && <article className={userCss.userRow}><div className={userCss.userStack}><div data-localapp-user-bubble="" className={userCss.bubble}><DshMarkdown text={userText ?? ""} /></div></div></article>}
      {process.length > 0 && <ConversationProcess running={active}>{process}</ConversationProcess>}
      {answer.length > 0 && <article className={assistantCss.root}><div className={assistantCss.body}>{answer}</div></article>}
    </div>;
  })}</div>;
}
