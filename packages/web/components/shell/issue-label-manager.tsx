"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IssueLabelDefinition } from "./issue-types";

type LabelDraft = { name: string; color: string; description: string };
const EMPTY_DRAFT: LabelDraft = { name: "", color: "1f6feb", description: "" };

export function IssueLabelManager({ labels, saving, error, onCreate, onUpdate, onDelete }: {
  labels: IssueLabelDefinition[];
  saving: boolean;
  error: string | null;
  onCreate: (draft: LabelDraft) => Promise<void>;
  onUpdate: (id: string, draft: LabelDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<LabelDraft>(EMPTY_DRAFT);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { if (editingId) nameRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (confirmingDelete) deleteCancelRef.current?.focus(); }, [confirmingDelete]);

  const begin = (label?: IssueLabelDefinition) => {
    setConfirmingDelete(null);
    setEditingId(label?.id ?? "new");
    setDraft(label ? { name: label.name, color: label.color, description: label.description } : EMPTY_DRAFT);
  };
  const submit = async () => {
    if (!draft.name.trim() || !/^[0-9a-fA-F]{6}$/.test(draft.color)) return;
    try {
      const value = { ...draft, name: draft.name.trim(), color: draft.color.toLowerCase(), description: draft.description.trim() };
      if (editingId === "new") await onCreate(value);
      else if (editingId) await onUpdate(editingId, value);
      setEditingId(null);
    } catch { /* Parent renders the mutation error while preserving this draft. */ }
  };
  const closeDelete = () => {
    setConfirmingDelete(null);
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  };
  const remove = async (labelId: string) => {
    try { await onDelete(labelId); setConfirmingDelete(null); }
    catch { /* Parent renders the mutation error while preserving confirmation. */ }
  };
  const deletingLabel = labels.find((label) => label.id === confirmingDelete);

  return <section aria-labelledby="issue-label-manager-title" className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between gap-3 border-b pb-4">
        <div><h3 id="issue-label-manager-title" className="text-lg font-semibold">标签</h3><p className="mt-1 text-sm text-muted-foreground">使用标签对 Issue 进行分类和筛选。</p></div>
        <Button type="button" size="sm" className="h-11 gap-1.5 sm:h-8" onClick={() => begin()}><Plus className="h-4 w-4" />新建标签</Button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {editingId && <div className="mt-4 rounded-md border bg-muted/20 p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
          <div><Label htmlFor="issue-label-name">名称</Label><Input ref={nameRef} id="issue-label-name" className="mt-1 h-11 sm:h-9" maxLength={50} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
          <div><Label htmlFor="issue-label-color">颜色</Label><div className="mt-1 flex h-11 items-center gap-2 rounded-md border bg-background px-2 sm:h-9"><input id="issue-label-color" aria-label="标签颜色选择器" type="color" className="h-7 w-8 cursor-pointer border-0 bg-transparent p-0" value={`#${/^[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : "000000"}`} onChange={(event) => setDraft({ ...draft, color: event.target.value.slice(1) })} /><input aria-label="标签颜色" className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" maxLength={6} value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value.replace(/^#/, "") })} /></div></div>
        </div>
        <div className="mt-4"><Label htmlFor="issue-label-description">描述</Label><Input id="issue-label-description" className="mt-1 h-11 sm:h-9" maxLength={200} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div>
        <div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => setEditingId(null)}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={saving || !draft.name.trim() || !/^[0-9a-fA-F]{6}$/.test(draft.color)} onClick={() => void submit()}>{saving ? "正在保存..." : editingId === "new" ? "创建标签" : "保存更改"}</Button></div>
      </div>}
      <ul aria-label="Issue 标签" className="mt-4 divide-y rounded-md border">{labels.map((label) => <li key={label.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: `#${label.color}` }} />
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-sm">{label.name}</strong>{Boolean(label.built_in) && <span className="text-xs text-muted-foreground">内置</span>}</div><p className="mt-0.5 truncate text-xs text-muted-foreground">{label.description || "无描述"}</p></div>
        {!label.built_in && <><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={`编辑标签 ${label.name}`} onClick={() => begin(label)}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-destructive sm:h-8 sm:w-8" aria-label={`删除标签 ${label.name}`} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setConfirmingDelete(label.id); }}><Trash2 className="h-4 w-4" /></Button></>}
      </li>)}</ul>
    </div>
    {deletingLabel && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4"><div role="alertdialog" aria-modal="true" aria-label={`删除标签 ${deletingLabel.name} 确认`} aria-describedby="delete-label-description" onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); closeDelete(); } else if (event.key === "Tab") { const first = deleteCancelRef.current; const last = deleteConfirmRef.current; if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }} className="w-full max-w-md rounded-md border bg-background p-4 shadow-xl"><p className="text-sm font-medium">删除“{deletingLabel.name}”？</p><p id="delete-label-description" className="mt-1 text-xs text-muted-foreground">该标签会从所有 Issue 中移除，此操作无法撤销。</p>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<div className="mt-3 flex justify-end gap-2"><Button ref={deleteCancelRef} type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={closeDelete}>取消</Button><Button ref={deleteConfirmRef} type="button" variant="destructive" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => void remove(deletingLabel.id)}>确认删除标签</Button></div></div></div>}
  </section>;
}
