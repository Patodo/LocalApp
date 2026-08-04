import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ListPlus } from "lucide-react";
import { collectIssueTasks } from "./issue-task-list";
import { readIssueReference, remarkIssueReferences } from "./issue-reference";

interface IssueTaskHastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: IssueTaskHastNode[];
}

export function rehypeIssueTaskIndexes() {
  return (tree: IssueTaskHastNode) => {
    let index = 0;
    const visit = (node: IssueTaskHastNode) => {
      if (node.type === "element" && node.tagName === "input" && node.properties?.type === "checkbox") {
        node.properties.dataIssueTaskIndex = index++;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}

export function IssueMarkdown({ children, className = "", tasksDisabled = false, onToggleTask, onConvertTask, getIssueReferenceHref, onOpenIssueReference }: { children: string; className?: string; tasksDisabled?: boolean; onToggleTask?: (taskIndex: number, checked: boolean) => void; onConvertTask?: (taskIndex: number, title: string, trigger: HTMLButtonElement) => void; getIssueReferenceHref?: (issueNumber: number) => string; onOpenIssueReference?: (issueNumber: number) => void }) {
  const tasks = collectIssueTasks(children);
  const completed = tasks.filter((task) => task.checked).length;
  return (
    <div className={`min-w-0 ${className}`}>
      {tasks.length > 0 && <div role="progressbar" aria-label="任务进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={tasks.length} aria-valuetext={`已完成 ${completed} / ${tasks.length} 个任务`} className="mb-3 flex items-center gap-3 text-xs text-muted-foreground"><span className="shrink-0 font-medium">任务 {completed} / {tasks.length}</span><span className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-emerald-600 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.round((completed / tasks.length) * 100)}%` }} /></span></div>}
      <div className="prose prose-sm min-w-0 max-w-none overflow-hidden break-words text-sm leading-6 [overflow-wrap:anywhere] dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkIssueReferences]} rehypePlugins={[rehypeIssueTaskIndexes]} components={{
        pre: ({ children: content, ...props }) => <pre {...props} className="max-w-full overflow-x-auto">{content}</pre>,
        code: ({ children: content, ...props }) => <code {...props} className="break-normal [overflow-wrap:normal]">{content}</code>,
        a: ({ children: content, href, ...props }) => {
          const issueNumber = readIssueReference(href);
          const resolvedHref = issueNumber !== null && getIssueReferenceHref ? getIssueReferenceHref(issueNumber) : href;
          return <a {...props} href={resolvedHref} tabIndex={issueNumber !== null ? -1 : undefined} data-localapp-issue-reference={issueNumber ?? undefined} className="break-all" onClick={issueNumber !== null && onOpenIssueReference ? (event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onOpenIssueReference(issueNumber); } : undefined}>{content}</a>;
        },
        img: ({ ...props }) => <img {...props} className="h-auto max-w-full" />,
        input: ({ type, checked, ...props }) => {
          if (type !== "checkbox") return <input type={type} {...props} />;
          const rawIndex = (props as Record<string, unknown>)["data-issue-task-index"];
          const index = typeof rawIndex === "number" && Number.isSafeInteger(rawIndex) && rawIndex >= 0 ? rawIndex : null;
          const task = index === null ? null : tasks[index];
          return <><label className="-my-2 mr-1 inline-flex h-11 w-11 cursor-pointer items-center justify-center align-middle sm:-my-0 sm:h-6 sm:w-6"><input {...props} type="checkbox" className="h-4 w-4" checked={Boolean(checked)} disabled={index === null || !onToggleTask || tasksDisabled} aria-label={index === null ? `任务，${checked ? "已完成" : "未完成"}` : `任务 ${index + 1}，${checked ? "已完成" : "未完成"}`} onChange={(event) => { if (index !== null) onToggleTask?.(index, event.currentTarget.checked); }} /></label>{task?.convertible && onConvertTask && <button type="button" title="转换为 Sub-issue" aria-label={`将任务 ${index! + 1} 转换为 Sub-issue`} disabled={tasksDisabled} className="-my-2 mr-1 inline-flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:-my-0 sm:h-6 sm:w-6" onClick={(event) => onConvertTask(index!, task.title, event.currentTarget)}><ListPlus className="h-4 w-4" aria-hidden="true" /></button>}</>;
        },
      }}>{children}</ReactMarkdown>
      </div>
    </div>
  );
}
