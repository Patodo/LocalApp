import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, CopyPlus, LoaderCircle, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IssueActionMenu } from "./issue-action-menu";
import type { IssueListQuery } from "./issue-list-query";
import type { IssueSavedView } from "./issue-types";

interface IssueSavedViewsProps {
  views: IssueSavedView[];
  activeViewId: number | null;
  dirty: boolean;
  currentQuery: IssueListQuery;
  loading: boolean;
  error: string | null;
  saving: boolean;
  onApply: (view: IssueSavedView) => void;
  onCreate: (name: string, description: string) => Promise<void>;
  onUpdate: (id: number, input: { name?: string; description?: string; query?: IssueListQuery }) => Promise<void>;
  onCopy: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onRetry: () => void;
}

type EditorState = { mode: "create" | "save-as" | "edit"; view?: IssueSavedView } | null;

export function IssueSavedViews({ views, activeViewId, dirty, currentQuery, loading, error, saving, onApply, onCreate, onUpdate, onCopy, onDelete, onRetry }: IssueSavedViewsProps) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<IssueSavedView | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const activeView = views.find((view) => view.id === activeViewId) ?? null;

  useEffect(() => {
    if (!editor) return;
    setName(editor.mode === "edit" ? editor.view?.name ?? "" : editor.mode === "save-as" && activeView ? `${activeView.name} copy` : "");
    setDescription(editor.mode === "edit" ? editor.view?.description ?? "" : editor.mode === "save-as" ? activeView?.description ?? "" : "");
    setLocalError(null);
  }, [activeView, editor]);

  const openEditor = (next: NonNullable<EditorState>) => setEditor(next);
  const closeEditor = () => { if (!saving) setEditor(null); };
  const submitEditor = async () => {
    if (!editor || !name.trim() || saving) return;
    setLocalError(null);
    try {
      if (editor.mode === "edit" && editor.view) await onUpdate(editor.view.id, { name: name.trim(), description: description.trim() });
      else await onCreate(name.trim(), description.trim());
      setEditor(null);
    } catch (requestError) { setLocalError(requestError instanceof Error ? requestError.message : "保存视图失败"); }
  };
  const copyView = async (id: number) => { setLocalError(null); try { await onCopy(id); } catch (requestError) { setLocalError(requestError instanceof Error ? requestError.message : "复制视图失败"); } };
  const removeView = async () => {
    if (!deleting || saving) return;
    setLocalError(null);
    try { await onDelete(deleting.id); setDeleting(null); }
    catch (requestError) { setLocalError(requestError instanceof Error ? requestError.message : "删除视图失败"); }
  };

  return <section aria-labelledby="issue-saved-views-title" className="mt-2 min-w-0 lg:mt-4 lg:border-t lg:pt-3">
    <div className="mb-1 flex min-h-8 items-center justify-end gap-2 px-0 lg:px-2">
      <h3 id="issue-saved-views-title" className="sr-only min-w-0 flex-1 text-xs font-semibold uppercase text-muted-foreground lg:not-sr-only">保存的视图</h3>
      {activeView && dirty && <><Button type="button" variant="ghost" size="icon" className="h-11 w-11 lg:h-8 lg:w-8" aria-label="保存视图更改" title="保存更改" disabled={saving} onClick={() => void onUpdate(activeView.id, { query: currentQuery })}><Save className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 lg:h-8 lg:w-8" aria-label="将当前查询另存为视图" title="另存为" disabled={saving} onClick={() => openEditor({ mode: "save-as" })}><CopyPlus className="h-4 w-4" /></Button></>}
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 lg:h-8 lg:w-8" aria-label="保存当前 Issue 视图" title="保存当前视图" onClick={() => openEditor({ mode: "create" })}><BookmarkPlus className="h-4 w-4" /></Button>
    </div>
    {loading && <p role="status" className="hidden min-h-11 items-center gap-2 px-2 text-xs text-muted-foreground lg:flex"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />正在加载保存视图...</p>}
    {error && <div role="alert" className="hidden space-y-2 px-2 py-2 text-xs text-destructive lg:block"><p>{error}</p><Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" aria-label="重试保存视图" onClick={onRetry}>重试</Button></div>}
    {!loading && !error && views.length === 0 && <p className="hidden px-2 py-2 text-xs text-muted-foreground lg:block">尚未保存视图</p>}
    {!loading && !error && views.length > 0 && <div className="hidden space-y-1 lg:block">{views.map((view) => <div key={view.id} className="group flex min-w-0 items-center gap-1">
      <button type="button" aria-label={`打开保存视图 ${view.name}`} aria-pressed={activeViewId === view.id} title={view.description || view.name} onClick={() => onApply(view)} className={`h-11 min-w-0 flex-1 truncate rounded px-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 ${activeViewId === view.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{view.name}{activeViewId === view.id && dirty ? <span aria-hidden="true"> *</span> : null}</button>
      <IssueActionMenu label={`管理保存视图 ${view.name}`} items={[
        { label: "编辑视图", restoreFocus: false, onSelect: () => openEditor({ mode: "edit", view }) },
        { label: "复制视图", onSelect: () => void copyView(view.id) },
        { label: "删除视图", destructive: true, restoreFocus: false, onSelect: () => { setDeleting(view); window.requestAnimationFrame(() => deleteCancelRef.current?.focus()); } },
      ]} />
    </div>)}</div>}
    {activeView && dirty && <p role="status" className="mt-2 hidden rounded-md border bg-muted/30 p-2 text-xs font-medium lg:block">有未保存更改</p>}
    {localError && !editor && <p role="alert" className="mt-2 px-2 text-xs text-destructive">{localError}</p>}

    {editor && <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div role="dialog" aria-modal="true" aria-labelledby="saved-view-editor-title" className="w-full max-w-lg overflow-hidden rounded-md border bg-card shadow-2xl">
      <header className="flex min-h-14 items-center gap-3 border-b px-4"><h3 id="saved-view-editor-title" className="min-w-0 flex-1 text-sm font-semibold">{editor.mode === "edit" ? "编辑保存视图" : editor.mode === "save-as" ? "另存当前视图" : "保存当前视图"}</h3><Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="关闭保存视图编辑器" onClick={closeEditor}><X className="h-4 w-4" /></Button></header>
      <div className="space-y-4 p-4"><div className="space-y-1.5"><Label htmlFor="saved-view-name">视图名称</Label><Input id="saved-view-name" autoFocus value={name} maxLength={50} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-1.5"><Label htmlFor="saved-view-description">视图说明</Label><Input id="saved-view-description" value={description} maxLength={200} onChange={(event) => setDescription(event.target.value)} /></div>{localError && <p role="alert" className="text-sm text-destructive">{localError}</p>}</div>
      <footer className="flex justify-end gap-2 border-t px-4 py-3"><Button type="button" variant="outline" className="h-11 sm:h-8" disabled={saving} onClick={closeEditor}>取消</Button><Button type="button" className="h-11 sm:h-8" disabled={saving || !name.trim()} onClick={() => void submitEditor()}>{saving ? "保存中..." : "保存视图"}</Button></footer>
    </div></div>}

    {deleting && <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="saved-view-delete-title" aria-describedby="saved-view-delete-description" className="w-full max-w-md overflow-hidden rounded-md border bg-card shadow-2xl"><div className="space-y-2 p-4"><h3 id="saved-view-delete-title" className="text-sm font-semibold">删除保存视图</h3><p id="saved-view-delete-description" className="text-sm text-muted-foreground">“{deleting.name}”将从你的个人视图中删除，不会修改任何 Issue。</p>{localError && <p role="alert" className="text-sm text-destructive">{localError}</p>}</div><footer className="flex justify-end gap-2 border-t px-4 py-3"><Button ref={deleteCancelRef} type="button" variant="outline" className="h-11 sm:h-8" disabled={saving} onClick={() => setDeleting(null)}>取消删除</Button><Button type="button" variant="destructive" className="h-11 sm:h-8" aria-label="确认删除视图" disabled={saving} onClick={() => void removeView()}>{saving ? "删除中..." : "确认删除"}</Button></footer></div></div>}
  </section>;
}
