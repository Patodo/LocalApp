import { useRef, useState } from "react";
import { CircleCheck, CircleDot, Link2, Network, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveIssueIdentity } from "./issue-identity";
import type { Issue, IssueDetail, IssueUserIdentity } from "./issue-types";

type Direction = "blockedBy" | "blocking";
type DependencyItem = Issue & { assignee_ids: string[] };

interface IssueDependenciesProps {
  detail: IssueDetail;
  identities: readonly IssueUserIdentity[];
  canManage: boolean;
  saving: boolean;
  getIssueHref?: (issueNumber: number) => string;
  onOpenIssue?: (issueNumber: number) => void;
  onAdd: (direction: Direction, issueNumber: number) => Promise<void>;
  onRemove: (direction: Direction, issueId: number) => Promise<void>;
}

export function IssueDependencies({ detail, identities, canManage, saving, getIssueHref, onOpenIssue, onAdd, onRemove }: IssueDependenciesProps) {
  const [adding, setAdding] = useState<Direction | null>(null);
  const [issueNumber, setIssueNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const triggerRefs = useRef<Record<Direction, HTMLButtonElement | null>>({ blockedBy: null, blocking: null });
  const summary = detail.dependencySummary ?? { blockedBy: 0, blocking: 0, unresolvedBlockers: 0, isBlocked: false };
  const submit = async () => {
    if (!adding) return;
    const parsed = Number(issueNumber.replace(/^#/, ""));
    if (!Number.isSafeInteger(parsed) || parsed < 1) { setError("请输入有效的 Issue 编号"); return; }
    setError(null);
    try {
      await onAdd(adding, parsed);
      const completedDirection = adding;
      setIssueNumber(""); setAdding(null);
      window.requestAnimationFrame(() => triggerRefs.current[completedDirection]?.focus());
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "无法添加 Issue 依赖"); }
  };
  const groups: Array<{ direction: Direction; title: string; empty: string; items: DependencyItem[] }> = [
    { direction: "blockedBy", title: "被以下 Issue 阻塞", empty: "没有 blocker", items: detail.blockedBy ?? [] },
    { direction: "blocking", title: "正在阻塞", empty: "没有阻塞其他 Issue", items: detail.blocking ?? [] },
  ];
  return <section data-localapp-issue-dependencies aria-labelledby="issue-dependencies-title" className="mt-5 overflow-hidden rounded-[6px] border bg-card">
    <header className="flex min-w-0 items-center gap-3 border-b bg-muted/20 px-4 py-3"><Network className="h-4 w-4 shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1"><h4 id="issue-dependencies-title" className="text-sm font-semibold">Relationships</h4><p className="text-xs text-muted-foreground">{summary.unresolvedBlockers ? `${summary.unresolvedBlockers} 个未解决 blocker` : "当前未被阻塞"}</p></div></header>
    {groups.map((group) => <div key={group.direction} className="border-b last:border-b-0">
      <div className="flex min-h-11 items-center gap-2 px-4 py-2"><h5 className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">{group.title}</h5>{canManage && <Button ref={(node) => { triggerRefs.current[group.direction] = node; }} type="button" variant="ghost" size="sm" className="h-11 gap-1.5 sm:h-8" disabled={saving} aria-expanded={adding === group.direction} onClick={() => { setError(null); setIssueNumber(""); setAdding((current) => current === group.direction ? null : group.direction); }}><Link2 className="h-4 w-4" />添加</Button>}</div>
      {adding === group.direction && <form className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submit(); }}><Input autoFocus aria-label={`${group.title}的 Issue 编号`} placeholder="#123" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className="h-11 min-w-0 flex-1 sm:h-9" /><div className="flex gap-2"><Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => { setAdding(null); setError(null); window.requestAnimationFrame(() => triggerRefs.current[group.direction]?.focus()); }}>取消</Button><Button type="submit" className="h-11 sm:h-9" disabled={saving}>添加依赖</Button></div>{error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}</form>}
      {group.items.length === 0 ? <p className="border-t px-4 py-3 text-xs text-muted-foreground">{group.empty}</p> : <ul aria-label={group.title} className="divide-y border-t">{group.items.map((issue) => <li key={issue.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">{issue.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-violet-600" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-emerald-700" aria-label="开启" />}<a href={getIssueHref?.(issue.issue_number) ?? "#"} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { if (!onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="min-w-0 flex-1 break-words">{issue.title}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">#{issue.issue_number}</span></a>{issue.assignee_ids.slice(0, 3).map((id) => { const identity = resolveIssueIdentity(id, identities); return <span key={id} title={`${identity.displayName} @${id}`} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-[10px] font-semibold sm:flex">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span>; })}{canManage && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" disabled={saving} aria-label={`移除依赖 #${issue.issue_number}`} onClick={() => { setError(null); void onRemove(group.direction, issue.id).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "无法移除 Issue 依赖")); }}><Unlink className="h-4 w-4" /></Button>}</li>)}</ul>}
    </div>)}
    {error && !adding && <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">{error}</p>}
  </section>;
}
