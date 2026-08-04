"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getIssueRevisions } from "./issue-api";
import { IssueMarkdown } from "./issue-markdown";
import { resolveIssueIdentity } from "./issue-identity";
import type { IssueRevision, IssueUserIdentity } from "./issue-types";

interface IssueRevisionDialogProps {
  pagePath: string;
  issueId: number;
  commentId?: number;
  currentTitle?: string;
  currentBody: string;
  currentUpdatedAt: string;
  identities: readonly IssueUserIdentity[];
  returnFocus: HTMLElement | null;
  onClose: () => void;
}

const FOCUSABLE = "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";

export function IssueRevisionDialog({ pagePath, issueId, commentId, currentTitle, currentBody, currentUpdatedAt, identities, returnFocus, onClose }: IssueRevisionDialogProps) {
  const [revisions, setRevisions] = useState<IssueRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRevisions(await getIssueRevisions(pagePath, issueId, commentId)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法加载编辑历史"); }
    finally { setLoading(false); }
  }, [commentId, issueId, pagePath]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    dialogRef.current?.focus();
    return () => { if (returnFocus?.isConnected) returnFocus.focus(); };
  }, [returnFocus]);

  const close = () => onClose();
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab" || !dialogRef.current) return;
    event.stopPropagation();
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const newestEditor = revisions[0] ? resolveIssueIdentity(revisions[0].editor_id, identities) : null;
  return <div data-localapp-issue-history-layer className="absolute inset-0 z-[70] flex items-center justify-center bg-black/45 p-0 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="issue-history-title" aria-describedby="issue-history-target" tabIndex={-1} onKeyDown={onKeyDown} className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-card shadow-2xl outline-none sm:h-[min(760px,calc(100%-2rem))] sm:rounded-lg sm:border">
      <header className="flex min-h-14 items-center gap-3 border-b px-4 py-3 sm:px-5"><div className="min-w-0 flex-1"><h3 id="issue-history-title" className="truncate text-sm font-semibold">编辑历史</h3><p id="issue-history-target" className="truncate text-xs text-muted-foreground">{commentId === undefined ? `Issue #${issueId}` : `评论 #${commentId}`}</p></div><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="关闭编辑历史" onClick={close}><X className="h-4 w-4" /></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在加载编辑历史...</p>
          : error ? <div role="alert" className="mx-auto max-w-md rounded-[6px] border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" size="sm" className="mt-3 h-11 sm:h-8" onClick={() => void load()}>重试</Button></div>
            : <ol aria-label="编辑历史版本" className="space-y-4">
              <li className="overflow-hidden rounded-[6px] border"><header className="border-b bg-muted/20 px-4 py-2.5 text-xs"><strong>当前版本</strong><span className="ml-2 text-muted-foreground">{new Date(currentUpdatedAt).toLocaleString()}{newestEditor ? ` · ${newestEditor.displayName || newestEditor.name || newestEditor.id}` : ""}</span></header><div className="min-w-0 px-4 py-4">{currentTitle !== undefined && <h4 className="mb-3 break-words text-base font-semibold">{currentTitle}</h4>}<IssueMarkdown>{currentBody.trim() || "未提供内容。"}</IssueMarkdown></div></li>
              {revisions.map((revision) => { const editor = resolveIssueIdentity(revision.editor_id, identities); return <li key={revision.id} className="overflow-hidden rounded-[6px] border"><header className="border-b bg-muted/20 px-4 py-2.5 text-xs"><strong>编辑前版本</strong><span className="ml-2 text-muted-foreground">{new Date(revision.created_at).toLocaleString()} · {editor.displayName || editor.name || editor.id}</span></header><div className="min-w-0 px-4 py-4">{revision.title !== null && <h4 className="mb-3 break-words text-base font-semibold">{revision.title}</h4>}<IssueMarkdown>{revision.body.trim() || "未提供内容。"}</IssueMarkdown></div></li>; })}
            </ol>}
      </div>
    </div>
  </div>;
}
