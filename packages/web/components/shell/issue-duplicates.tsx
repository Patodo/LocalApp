"use client";

import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IssueDuplicateItem } from "./issue-types";

interface Props {
  duplicateOf?: IssueDuplicateItem | null;
  duplicates?: readonly IssueDuplicateItem[];
  canManage: boolean;
  getIssueHref: (issueNumber: number) => string;
  onOpenIssue?: (issueNumber: number) => void;
  onUnmark: (canonicalIssueId: number) => Promise<void>;
}

function IssueLink({ issue, prefix, getIssueHref, onOpenIssue }: { issue: IssueDuplicateItem; prefix: string; getIssueHref: Props["getIssueHref"]; onOpenIssue?: Props["onOpenIssue"] }) {
  return <a href={getIssueHref(issue.issue_number)} aria-label={`${prefix} Issue #${issue.issue_number} ${issue.title}`} className="flex min-h-11 min-w-0 items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9" onClick={(event) => { if (!onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="shrink-0 text-muted-foreground">#{issue.issue_number}</span><span className="min-w-0 flex-1 break-words font-medium">{issue.title}</span></a>;
}

export function IssueDuplicates({ duplicateOf, duplicates = [], canManage, getIssueHref, onOpenIssue, onUnmark }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  if (!duplicateOf && duplicates.length === 0) return null;
  const undo = async () => {
    if (!duplicateOf || saving) return;
    setSaving(true); setError(null);
    let succeeded = false;
    try { await onUnmark(duplicateOf.id); succeeded = true; }
    catch (failure) { setError(failure instanceof Error ? failure.message : "撤销重复标记失败"); }
    finally { setSaving(false); requestAnimationFrame(() => (succeeded ? document.querySelector<HTMLElement>("[data-localapp-issue-title]") : undoRef.current)?.focus()); }
  };
  return <section aria-label="Duplicate Issues" className="mt-5 overflow-hidden rounded-[6px] border bg-card">
    {duplicateOf && <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-2"><Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="text-sm">此 Issue 是重复项：</span><a href={getIssueHref(duplicateOf.issue_number)} aria-label={`Canonical Issue #${duplicateOf.issue_number} ${duplicateOf.title}`} className="min-h-11 min-w-0 flex-1 break-words rounded py-2 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:py-1" onClick={(event) => { if (!onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(duplicateOf.issue_number); }}>#{duplicateOf.issue_number} {duplicateOf.title}</a>{canManage && <Button ref={undoRef} type="button" variant="outline" size="sm" className="h-11 shrink-0 sm:h-8" disabled={saving} onClick={() => void undo()}>{saving ? "撤销中..." : "撤销重复标记"}</Button>}</div>}
    {error && <p role="alert" className="border-b px-3 py-2 text-sm text-destructive">{error}</p>}
    {duplicates.length > 0 && <div><h4 className="px-3 pt-3 text-sm font-semibold">重复 Issue</h4><p className="px-3 pb-1 text-xs text-muted-foreground">以下 Issue 已标记为当前 Issue 的重复项</p><ul aria-label="重复 Issues" className="divide-y">{duplicates.map((issue) => <li key={issue.id}><IssueLink issue={issue} prefix="重复" getIssueHref={getIssueHref} onOpenIssue={onOpenIssue} /></li>)}</ul></div>}
  </section>;
}
