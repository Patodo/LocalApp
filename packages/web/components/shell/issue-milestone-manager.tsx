"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, CircleCheck, CircleDot, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IssueMilestoneDefinition } from "./issue-types";

type MilestoneDraft = { title: string; description: string; dueOn: string | null; state: "open" | "closed" };
const EMPTY_DRAFT: MilestoneDraft = { title: "", description: "", dueOn: null, state: "open" };

export function IssueMilestoneManager({ milestones, saving, error, onCreate, onUpdate, onDelete }: {
  milestones: IssueMilestoneDefinition[]; saving: boolean; error: string | null;
  onCreate: (draft: Omit<MilestoneDraft, "state">) => Promise<void>;
  onUpdate: (id: number, draft: MilestoneDraft) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<MilestoneDraft>(EMPTY_DRAFT);
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (editingId) titleRef.current?.focus(); }, [editingId]);
  useEffect(() => { if (confirmingDelete !== null) cancelRef.current?.focus(); }, [confirmingDelete]);
  const begin = (item?: IssueMilestoneDefinition) => { setEditingId(item?.id ?? "new"); setDraft(item ? { title: item.title, description: item.description, dueOn: item.due_on, state: item.state } : EMPTY_DRAFT); };
  const submit = async () => {
    if (!draft.title.trim()) return;
    try { if (editingId === "new") await onCreate({ title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn || null }); else if (editingId !== null) await onUpdate(editingId, { ...draft, title: draft.title.trim(), description: draft.description.trim(), dueOn: draft.dueOn || null }); setEditingId(null); } catch { /* Parent keeps the error and this draft. */ }
  };
  const closeDelete = () => { setConfirmingDelete(null); requestAnimationFrame(() => deleteTriggerRef.current?.focus()); };
  const target = milestones.find(({ id }) => id === confirmingDelete);
  return <section aria-labelledby="issue-milestone-manager-title" className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6"><div className="mx-auto max-w-5xl">
    <div className="flex items-center justify-between gap-3 border-b pb-4"><div><h3 id="issue-milestone-manager-title" className="text-lg font-semibold">里程碑</h3><p className="mt-1 text-sm text-muted-foreground">按版本或阶段组织 Issue，并跟踪完成进度。</p></div><Button type="button" size="sm" className="h-11 gap-1.5 sm:h-8" onClick={() => begin()}><Plus className="h-4 w-4" />新建里程碑</Button></div>
    {error && <p role="alert" className="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    {editingId !== null && <div className="mt-4 rounded-md border bg-muted/20 p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]"><div><Label htmlFor="issue-milestone-title">标题</Label><Input ref={titleRef} id="issue-milestone-title" className="mt-1 h-11 sm:h-9" maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div><div><Label htmlFor="issue-milestone-due">截止日期</Label><Input id="issue-milestone-due" type="date" className="mt-1 h-11 sm:h-9" value={draft.dueOn ?? ""} onChange={(event) => setDraft({ ...draft, dueOn: event.target.value || null })} /></div></div><div className="mt-4"><Label htmlFor="issue-milestone-description">描述</Label><Input id="issue-milestone-description" className="mt-1 h-11 sm:h-9" maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></div><div className="mt-4 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => setEditingId(null)}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={saving || !draft.title.trim()} onClick={() => void submit()}>{saving ? "正在保存..." : editingId === "new" ? "创建里程碑" : "保存更改"}</Button></div></div>}
    <ul aria-label="Issue 里程碑" className="mt-4 divide-y rounded-md border">{milestones.map((item) => { const total = item.open_issues + item.closed_issues; const percent = total === 0 ? 0 : Math.round(item.closed_issues / total * 100); return <li key={item.id} className="px-4 py-4"><div className="flex min-w-0 items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.title}</strong><span className="inline-flex items-center gap-1 text-xs text-muted-foreground">{item.state === "open" ? <CircleDot className="h-3.5 w-3.5" /> : <CircleCheck className="h-3.5 w-3.5" />}{item.state === "open" ? "开启" : "已关闭"}</span>{item.due_on && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{item.due_on}</span>}</div><p className="mt-1 text-xs text-muted-foreground">{item.description || "无描述"}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div><p className="mt-1 text-xs text-muted-foreground">{percent}% 已完成 · {item.open_issues} 个开启 · {item.closed_issues} 个已关闭</p></div><div className="flex shrink-0 gap-1"><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={`编辑里程碑 ${item.title}`} onClick={() => begin(item)}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label={`${item.state === "open" ? "关闭" : "重开"}里程碑 ${item.title}`} onClick={() => void onUpdate(item.id, { title: item.title, description: item.description, dueOn: item.due_on, state: item.state === "open" ? "closed" : "open" })}>{item.state === "open" ? <CircleCheck className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}</Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-destructive sm:h-8 sm:w-8" aria-label={`删除里程碑 ${item.title}`} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setConfirmingDelete(item.id); }}><Trash2 className="h-4 w-4" /></Button></div></div></li>; })}</ul>
  </div>{target && <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4"><div role="alertdialog" aria-modal="true" aria-label={`删除里程碑 ${target.title} 确认`} onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); closeDelete(); } else if (event.key === "Tab" && cancelRef.current && confirmRef.current) { if (event.shiftKey && document.activeElement === cancelRef.current) { event.preventDefault(); confirmRef.current.focus(); } else if (!event.shiftKey && document.activeElement === confirmRef.current) { event.preventDefault(); cancelRef.current.focus(); } } }} className="w-full max-w-md rounded-md border bg-background p-4 shadow-xl"><p className="text-sm font-medium">删除“{target.title}”？</p><p className="mt-1 text-xs text-muted-foreground">关联的 Issue 会变为无里程碑，不会删除 Issue。此操作无法撤销。</p>{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<div className="mt-3 flex justify-end gap-2"><Button ref={cancelRef} type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={closeDelete}>取消</Button><Button ref={confirmRef} type="button" variant="destructive" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => void onDelete(target.id).then(() => setConfirmingDelete(null)).catch(() => undefined)}>确认删除里程碑</Button></div></div></div>}</section>;
}
