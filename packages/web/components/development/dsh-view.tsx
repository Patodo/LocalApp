"use client";
import {
  MarkdownText,
  TerminalBlock,
  DiffBlock,
  ReadBlock,
} from "@deepseek-ai/dsh-client-ui-primitives";
import "./dsh-theme.css";
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
}: {
  text: string;
  streaming?: boolean;
}) => (
  <MarkdownText
    text={text}
    streaming={streaming}
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
export function DshMessages({ messages }: { messages: any[] }) {
  const tools = new Map<string, any>();
  for (const m of messages)
    for (const b of Array.isArray(m.content) ? m.content : [])
      if (b.type === "toolCall") tools.set(b.id, b);
  return (
    <div className="space-y-4">
      {messages.map((m, i) => {
        if (m.role === "toolResult") {
          const tool = tools.get(m.toolCallId),
            text = (m.content ?? []).map((b: any) => b.text ?? "").join("\n");
          return (
            <details key={i} className="rounded-lg border p-2">
              <summary>
                {tool?.name ?? "工具结果"}
                {m.isError ? " · 失败" : ""}
              </summary>
              {tool?.name === "bash" ? (
                <DshTerminal
                  command={String(tool.arguments?.command ?? "")}
                  output={text}
                />
              ) : (
                <DshRead text={text} path={tool?.arguments?.path} />
              )}
            </details>
          );
        }
        return (
          <article key={i} className="rounded-lg border p-3">
            <div className="mb-2 text-xs text-muted-foreground">
              {m.role === "user" ? "你" : "Agent"}
            </div>
            {typeof m.content === "string" ? (
              <DshMarkdown text={m.content} />
            ) : (
              m.content?.map((b: any, j: number) =>
                b.type === "text" ? (
                  <DshMarkdown key={j} text={b.text} />
                ) : b.type === "reasoning" ? (
                  <details key={j}>
                    <summary>思考</summary>
                    <DshMarkdown text={b.text} />
                  </details>
                ) : b.type === "toolCall" ? (
                  <div key={j} className="text-sm text-muted-foreground">
                    {b.name} · {JSON.stringify(b.arguments)}
                  </div>
                ) : null,
              )
            )}
          </article>
        );
      })}
    </div>
  );
}
