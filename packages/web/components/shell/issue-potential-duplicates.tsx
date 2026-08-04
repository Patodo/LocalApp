import { CircleCheck, CircleDot, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IssueTime } from "./issue-time";
import type { IssuePotentialDuplicate } from "./issue-types";

interface IssuePotentialDuplicatesProps {
  candidates: readonly IssuePotentialDuplicate[];
  loading: boolean;
  error: string | null;
  getIssueHref: (issueNumber: number) => string;
  onOpenIssue: (issueNumber: number) => void;
  onRetry: () => void;
}

export function IssuePotentialDuplicates({ candidates, loading, error, getIssueHref, onOpenIssue, onRetry }: IssuePotentialDuplicatesProps) {
  if (!loading && !error && candidates.length === 0) return null;
  return <section data-localapp-potential-duplicates aria-labelledby="potential-duplicates-title" className="overflow-hidden rounded-[6px] border bg-muted/10">
    <header className="flex min-h-11 items-center gap-2 border-b px-3 py-2"><div className="min-w-0 flex-1"><h3 id="potential-duplicates-title" className="text-sm font-semibold">可能重复的 Issue</h3><p className="text-xs text-muted-foreground">提交前检查是否已有相同问题</p></div>{loading && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="正在查找潜在重复 Issue" />}</header>
    {error ? <div role="alert" className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 gap-1.5 sm:h-8" onClick={onRetry}><RotateCcw className="h-4 w-4" />重试</Button></div> : candidates.length > 0 && <ul aria-label="潜在重复 Issues" className="divide-y">{candidates.map((candidate) => <li key={candidate.id}><a href={getIssueHref(candidate.issue_number)} className="flex min-h-11 min-w-0 items-start gap-3 px-3 py-2.5 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(candidate.issue_number); }}>{candidate.status === "closed" ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="已关闭" /> : <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-label="开启" />}<span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{candidate.title}</span><span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>#{candidate.issue_number}</span><span>活动于</span><IssueTime timestamp={candidate.last_activity_at} /></span></span></a></li>)}</ul>}
  </section>;
}
