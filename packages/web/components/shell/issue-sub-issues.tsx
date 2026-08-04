import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleCheck, CircleDot, GitBranch, GripVertical, Link2, LoaderCircle, Plus, RotateCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveIssueIdentity } from "./issue-identity";
import { IssueActionMenu } from "./issue-action-menu";
import { listIssueSubIssues } from "./issue-api";
import type { IssueDetail, IssueSubIssueItem, IssueSubIssueListResult, IssueUserIdentity } from "./issue-types";

interface IssueSubIssuesProps {
  pagePath?: string;
  detail: IssueDetail;
  identities: readonly IssueUserIdentity[];
  canManage: boolean;
  saving: boolean;
  getIssueHref?: (issueNumber: number) => string;
  onOpenIssue?: (issueNumber: number) => void;
  onCreate: () => void;
  onLink: (issueNumber: number) => Promise<void>;
  onRemove: (childIssueId: number) => Promise<void>;
  onReprioritize: (childIssueId: number, afterIssueId: number | null) => Promise<void>;
  loadChildren?: (parentIssueId: number, signal: AbortSignal) => Promise<IssueSubIssueListResult>;
}

type BranchState = { status: "loading" | "loaded" | "error"; items: IssueSubIssueItem[]; error?: string };

export function IssueSubIssues({ pagePath = "", detail, identities, canManage, saving, getIssueHref, onOpenIssue, onCreate, onLink, onRemove, onReprioritize, loadChildren }: IssueSubIssuesProps) {
  const [linking, setLinking] = useState(false);
  const [issueNumber, setIssueNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const pendingFocusIdRef = useRef<number | null>(null);
  const linkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const controllersRef = useRef(new Map<number, AbortController>());
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [branches, setBranches] = useState<Record<number, BranchState>>({});
  const summary = detail.subIssueSummary ?? { total: 0, completed: 0, percent: 0 };
  const subIssues = detail.subIssues ?? [];
  const fetchChildren = useCallback(async (parentId: number, force = false) => {
    if (!force && branches[parentId]?.status === "loaded") return;
    controllersRef.current.get(parentId)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(parentId, controller);
    setBranches((current) => ({ ...current, [parentId]: { status: "loading", items: current[parentId]?.items ?? [] } }));
    try {
      const result = await (loadChildren ? loadChildren(parentId, controller.signal) : listIssueSubIssues(pagePath, parentId, controller.signal));
      if (!controller.signal.aborted) setBranches((current) => ({ ...current, [parentId]: { status: "loaded", items: result.items } }));
    } catch (requestError) {
      if (!controller.signal.aborted) setBranches((current) => ({ ...current, [parentId]: { status: "error", items: current[parentId]?.items ?? [], error: requestError instanceof Error ? requestError.message : "无法加载子层级" } }));
    }
  }, [branches, loadChildren, pagePath]);
  const toggleBranch = (issueId: number) => {
    setExpanded((current) => { const next = new Set(current); if (next.has(issueId)) next.delete(issueId); else { next.add(issueId); void fetchChildren(issueId); } return next; });
  };
  useEffect(() => () => { controllersRef.current.forEach((controller) => controller.abort()); }, []);
  useEffect(() => {
    for (const issueId of expanded) void fetchChildren(issueId, true);
  // Refresh expanded branches when SSE replaces the authoritative detail.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  useEffect(() => {
    if (pendingFocusIdRef.current === null || saving) return;
    const childId = pendingFocusIdRef.current;
    pendingFocusIdRef.current = null;
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-localapp-sub-issue-id="${childId}"] button[aria-label^="重排 Sub-issue"]`)?.focus());
  }, [saving, subIssues]);
  const reprioritize = async (childId: number, afterId: number | null) => {
    const index = subIssues.findIndex((item) => item.id === childId);
    setError(null);
    try {
      pendingFocusIdRef.current = childId;
      await onReprioritize(childId, afterId);
      const next = subIssues.filter((item) => item.id !== childId);
      const position = afterId === null ? 1 : next.findIndex((item) => item.id === afterId) + 2;
      setAnnouncement(`Sub-issue #${subIssues[index]?.issue_number ?? childId} 已移动到第 ${position} 位`);
    } catch (requestError) {
      pendingFocusIdRef.current = null;
      setError(requestError instanceof Error ? requestError.message : "无法重排 Sub-issue");
    }
  };
  const submitLink = async () => {
    const parsed = Number(issueNumber.replace(/^#/, ""));
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      setError("请输入有效的 Issue 编号");
      return;
    }
    setError(null);
    try {
      await onLink(parsed);
      setIssueNumber("");
      setLinking(false);
      window.requestAnimationFrame(() => linkTriggerRef.current?.focus());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "无法关联 Sub-issue");
    }
  };
  const renderNestedRows = (items: IssueSubIssueItem[], level: number, ancestors: Set<number>): ReactNode => (
    <ul role="group" className="border-t bg-muted/10">
      {items.map((issue) => {
        const hasChildren = (issue.child_count ?? 0) > 0;
        const isExpanded = expanded.has(issue.id);
        const branch = branches[issue.id];
        const cyclic = ancestors.has(issue.id) || level >= 8;
        const nextAncestors = new Set(ancestors).add(issue.id);
        return <li key={issue.id} role="treeitem" aria-level={level} aria-expanded={hasChildren && !cyclic ? isExpanded : undefined} data-localapp-sub-issue-id={issue.id}>
          <div className="flex min-w-0 items-center gap-2 py-2.5 pr-4" style={{ paddingLeft: `${Math.min(level, 8) * 20}px` }}>
            {hasChildren && !cyclic ? <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${isExpanded ? "折叠" : "展开"} Sub-issue #${issue.issue_number}`} onClick={() => toggleBranch(issue.id)} onKeyDown={(event) => { if (event.key === "ArrowRight" && !isExpanded) { event.preventDefault(); toggleBranch(issue.id); } else if (event.key === "ArrowLeft" && isExpanded) { event.preventDefault(); toggleBranch(issue.id); } }}>{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="h-8 w-8 shrink-0" />}
            {issue.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-violet-600" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-emerald-700" aria-label="开启" />}
            <a href={getIssueHref?.(issue.issue_number) ?? "#"} aria-label={`#${issue.issue_number} ${issue.title}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { if (!onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="min-w-0 flex-1 break-words">{issue.title}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">#{issue.issue_number}</span></a>
            {hasChildren && <span className="shrink-0 text-xs text-muted-foreground">{issue.completed_child_count ?? 0}/{issue.child_count}</span>}
          </div>
          {isExpanded && branch?.status === "loading" && <div role="status" className="flex items-center gap-2 py-3 pr-4 text-sm text-muted-foreground" style={{ paddingLeft: `${Math.min(level + 1, 8) * 20}px` }}><LoaderCircle className="h-4 w-4 animate-spin" />正在加载子项</div>}
          {isExpanded && branch?.status === "error" && <div role="alert" className="flex items-center gap-2 py-3 pr-4 text-sm text-destructive" style={{ paddingLeft: `${Math.min(level + 1, 8) * 20}px` }}><span className="min-w-0 flex-1">{branch.error}</span><Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => void fetchChildren(issue.id, true)}><RotateCw className="h-4 w-4" />重试</Button></div>}
          {isExpanded && branch?.status === "loaded" && branch.items.length > 0 && renderNestedRows(branch.items.filter((item) => !nextAncestors.has(item.id)), level + 1, nextAncestors)}
          {isExpanded && branch?.status === "loaded" && branch.items.length === 0 && <div className="py-3 pr-4 text-sm text-muted-foreground" style={{ paddingLeft: `${Math.min(level + 1, 8) * 20}px` }}>没有更多子项</div>}
        </li>;
      })}
    </ul>
  );

  return <section data-localapp-sub-issues aria-labelledby="issue-sub-issues-title" className="mt-5 overflow-hidden rounded-[6px] border bg-card">
    <span className="sr-only" aria-live="polite">{announcement}</span>
    <header className="flex min-w-0 flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3">
      <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h4 id="issue-sub-issues-title" className="text-sm font-semibold">Sub-issues</h4>
        <p className="text-xs text-muted-foreground">{summary.completed} / {summary.total} 已完成</p>
      </div>
      {canManage && <div className="flex items-center gap-1">
        <Button ref={linkTriggerRef} type="button" variant="ghost" size="sm" className="h-11 gap-1.5 sm:h-8" disabled={saving} aria-expanded={linking} onClick={() => { setError(null); setLinking((value) => !value); }}><Link2 className="h-4 w-4" />关联</Button>
        <Button type="button" variant="outline" size="sm" className="h-11 gap-1.5 sm:h-8" disabled={saving} onClick={onCreate}><Plus className="h-4 w-4" />创建子 Issue</Button>
      </div>}
    </header>
    {summary.total > 0 && <div className="h-1 bg-muted" role="progressbar" aria-label="Sub-issues 完成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.percent}><div className="h-full bg-emerald-600" style={{ width: `${summary.percent}%` }} /></div>}
    {linking && <form className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); void submitLink(); }}>
      <Input autoFocus aria-label="要关联的 Issue 编号" placeholder="#123" value={issueNumber} onChange={(event) => setIssueNumber(event.target.value)} className="h-11 min-w-0 flex-1 sm:h-9" />
      <div className="flex gap-2"><Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => { setLinking(false); setError(null); window.requestAnimationFrame(() => linkTriggerRef.current?.focus()); }}>取消</Button><Button type="submit" className="h-11 sm:h-9" disabled={saving}>关联 Issue</Button></div>
      {error && <p role="alert" className="basis-full text-sm text-destructive">{error}</p>}
    </form>}
    {subIssues.length === 0 ? <div className="px-4 py-8 text-center text-sm text-muted-foreground">还没有 Sub-issue</div> : <ul role="tree" aria-label="Sub-issues" className="divide-y" onDragOver={(event) => { if (canManage && draggingId !== null) event.preventDefault(); }} onDrop={(event) => { if (!canManage || draggingId === null || event.target !== event.currentTarget) return; event.preventDefault(); void reprioritize(draggingId, null); setDraggingId(null); }}>{draggingId !== null && <li data-localapp-sub-issue-drop-first className="h-3 bg-primary/10" aria-hidden="true" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void reprioritize(draggingId, null); setDraggingId(null); }} />}{subIssues.map((issue, index) => {
      const href = getIssueHref?.(issue.issue_number) ?? "#";
      const previousAfterId = index <= 1 ? null : subIssues[index - 2].id;
      const nextAfterId = index < subIssues.length - 1 ? subIssues[index + 1].id : issue.id;
      const lastAfterId = subIssues.at(-1)?.id ?? issue.id;
      const hasChildren = (issue.child_count ?? 0) > 0;
      const isExpanded = expanded.has(issue.id);
      const branch = branches[issue.id];
      return <li key={issue.id} role="treeitem" aria-level={1} aria-expanded={hasChildren ? isExpanded : undefined} data-localapp-sub-issue-id={issue.id} className={draggingId === issue.id ? "opacity-60" : ""} onDragOver={(event) => { if (canManage && draggingId !== null && draggingId !== issue.id) event.preventDefault(); }} onDrop={(event) => { if (!canManage || draggingId === null || draggingId === issue.id) return; event.preventDefault(); event.stopPropagation(); void reprioritize(draggingId, issue.id); setDraggingId(null); }}><div className="flex min-w-0 items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        {canManage && <button type="button" draggable={!saving} aria-label={`拖动 Sub-issue #${issue.issue_number}`} title="拖动重排" disabled={saving} className="hidden h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex" onDragStart={(event) => { setDraggingId(issue.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(issue.id)); }} onDragEnd={() => setDraggingId(null)}><GripVertical className="h-4 w-4" /></button>}
        {hasChildren ? <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${isExpanded ? "折叠" : "展开"} Sub-issue #${issue.issue_number}`} onClick={() => toggleBranch(issue.id)} onKeyDown={(event) => { if (event.key === "ArrowRight" && !isExpanded) { event.preventDefault(); toggleBranch(issue.id); } else if (event.key === "ArrowLeft" && isExpanded) { event.preventDefault(); toggleBranch(issue.id); } }}>{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button> : <span className="h-8 w-8 shrink-0" />}
        {issue.status === "closed" ? <CircleCheck className="h-4 w-4 shrink-0 text-violet-600" aria-label="已关闭" /> : <CircleDot className="h-4 w-4 shrink-0 text-emerald-700" aria-label="开启" />}
        <a href={href} aria-label={`#${issue.issue_number} ${issue.title}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { if (!onOpenIssue || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssue(issue.issue_number); }}><span className="min-w-0 flex-1 break-words">{issue.title}</span><span className="shrink-0 text-xs font-normal text-muted-foreground">#{issue.issue_number}</span></a>
        {issue.assignee_ids.slice(0, 3).map((id) => { const identity = resolveIssueIdentity(id, identities); return <span key={id} title={`${identity.displayName} @${id}`} aria-label={`负责人 ${identity.displayName}`} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-[10px] font-semibold sm:flex">{Array.from(identity.displayName)[0]?.toLocaleUpperCase() || "?"}</span>; })}
        {canManage && <IssueActionMenu label={`重排 Sub-issue #${issue.issue_number}`} items={[
          { label: "移到顶部", disabled: saving || index === 0, restoreFocus: false, onSelect: () => void reprioritize(issue.id, null) },
          { label: "上移", disabled: saving || index === 0, restoreFocus: false, onSelect: () => void reprioritize(issue.id, previousAfterId) },
          { label: "下移", disabled: saving || index === subIssues.length - 1, restoreFocus: false, onSelect: () => void reprioritize(issue.id, nextAfterId) },
          { label: "移到底部", disabled: saving || index === subIssues.length - 1, restoreFocus: false, onSelect: () => void reprioritize(issue.id, lastAfterId) },
        ]} />}
        {canManage && <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" disabled={saving} aria-label={`移除 Sub-issue #${issue.issue_number}`} onClick={() => { setError(null); void onRemove(issue.id).catch((requestError) => setError(requestError instanceof Error ? requestError.message : "无法移除 Sub-issue")); }}><Unlink className="h-4 w-4" /></Button>}
      </div>{isExpanded && branch?.status === "loading" && <div role="status" className="flex items-center gap-2 border-t px-12 py-3 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在加载子项</div>}{isExpanded && branch?.status === "error" && <div role="alert" className="flex items-center gap-2 border-t px-12 py-3 text-sm text-destructive"><span className="min-w-0 flex-1">{branch.error}</span><Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => void fetchChildren(issue.id, true)}><RotateCw className="h-4 w-4" />重试</Button></div>}{isExpanded && branch?.status === "loaded" && branch.items.length > 0 && renderNestedRows(branch.items.filter((item) => item.id !== detail.issue.id && item.id !== issue.id), 2, new Set([detail.issue.id, issue.id]))}</li>;
    })}</ul>}
    {error && !linking && <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">{error}</p>}
  </section>;
}
