"use client";

import { GitBranch } from "lucide-react";
import type { MouseEvent } from "react";
import type { IssueCrossReferenceRecord } from "./issue-types";
import { IssueTime } from "./issue-time";

export function IssueCrossReference({ reference, actorName, href, onOpen }: {
  reference: IssueCrossReferenceRecord;
  actorName: string;
  href: string;
  onOpen?: (issueNumber: number, commentId: number | null) => void;
}) {
  const accessibleName = `来源 Issue #${reference.source_issue_number} ${reference.source_issue_title}${reference.source_comment_id === null ? "" : `，评论 ${reference.source_comment_id}`}`;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(reference.source_issue_number, reference.source_comment_id);
  };
  return <li data-localapp-issue-cross-reference className="relative min-w-0 py-2 pl-3 text-xs text-muted-foreground before:absolute before:bottom-0 before:left-[19px] before:top-0 before:w-px before:bg-border">
    <div className="flex min-w-0 items-start gap-2"><span className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-card"><GitBranch className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="break-words"><strong className="font-semibold text-foreground">{actorName}</strong> 在 <a href={href} aria-label={accessibleName} className="font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={open}>#{reference.source_issue_number} {reference.source_issue_title}</a> 中提到了此 Issue <IssueTime timestamp={reference.created_at} /></p>{reference.excerpt && <p className="mt-1 line-clamp-2 break-words border-l-2 pl-2 text-muted-foreground">{reference.excerpt}</p>}</div></div>
  </li>;
}
