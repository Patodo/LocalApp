import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IssueTemplateConfig } from "./issue-types";

interface IssueTemplateChooserProps {
  templates: readonly IssueTemplateConfig[];
  loading: boolean;
  error: string | null;
  onSelect: (template: IssueTemplateConfig) => void;
  onBlank: () => void;
  onRetry: () => void;
}

export function IssueTemplateChooser({ templates, loading, error, onSelect, onBlank, onRetry }: IssueTemplateChooserProps) {
  return (
    <main data-testid="issue-template-chooser" className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5">
          <h3 className="text-base font-semibold">选择 Issue 模板</h3>
          <p className="mt-1 text-sm text-muted-foreground">选择最符合当前工作的模板，或从空白 Issue 开始。</p>
        </div>
        {error && <div role="alert" className="mb-4 flex min-h-11 flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span className="min-w-0 flex-1">{error}</span><Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={onRetry}>重试</Button></div>}
        {loading && templates.length === 0 ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">正在加载 Issue 模板...</p> : <ul aria-label="Issue 模板" className="divide-y rounded-md border bg-background">{templates.map((template) => <li key={template.id} className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted"><FileText className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block break-words text-sm">{template.name}</strong><span className="mt-1 block break-words text-sm text-muted-foreground">{template.description}</span></span><Button type="button" variant="outline" size="sm" className="h-11 w-full shrink-0 sm:h-8 sm:w-auto" onClick={() => onSelect(template)}>开始</Button></li>)}</ul>}
        <div className="mt-5 flex min-w-0 flex-col gap-3 rounded-md border border-dashed px-4 py-4 sm:flex-row sm:items-center"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted"><Plus className="h-4 w-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">空白 Issue</strong><span className="mt-1 block text-sm text-muted-foreground">不使用模板，自由填写标题和描述。</span></span><Button type="button" size="sm" className="h-11 w-full shrink-0 sm:h-8 sm:w-auto" onClick={onBlank}>打开空白 Issue</Button></div>
      </div>
    </main>
  );
}
