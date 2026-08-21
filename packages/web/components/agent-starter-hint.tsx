"use client";

import { useState } from "react";
import { Bot, Check, Copy } from "lucide-react";

export function agentStarterPhrase(origin: string): string {
  return `阅读 ${origin}/starter.md 的说明创建应用`;
}

export function AgentStarterHint({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const phrase = agentStarterPhrase(origin);

  return (
    <div className={compact ? "text-left" : "text-left"}>
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold">交给 Agent 一句话</p>
      </div>
      <p className="mt-1 text-xs leading-5 text-black/55">
        把下面这句话发给你的 AI Agent（或粘贴到对话里），它会阅读 starter.md 并自动完成创建、实现和安装。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <code className="min-w-0 break-all rounded-md border border-black/10 bg-white px-3 py-2 font-mono text-xs font-semibold text-black">
          {phrase}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(phrase).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-bold transition ${
            copied
              ? "border-black/20 bg-black/5 text-black"
              : "border-black/10 bg-white text-black/50 hover:bg-black/5 hover:text-black"
          }`}
        >
          {copied ? (
            <>
              <span>已复制</span>
              <Check className="h-4 w-4" />
            </>
          ) : (
            <>
              <span>复制</span>
              <Copy className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
      <a
        href="/starter.md"
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-xs underline decoration-black/25 underline-offset-4 hover:decoration-current"
      >
        查看 starter.md 完整说明
      </a>
    </div>
  );
}
