"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { MessageSquareReply, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface IssueSavedReply {
  id: number;
  title: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
}

interface Props {
  tabIndex: number;
  onFocus: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onInsert: (reply: IssueSavedReply) => void;
}

async function savedReplyRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { credentials: "include", ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const payload = await response.json().catch(() => null) as { data?: unknown; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `保存回复请求失败 (${response.status})`);
  return payload?.data;
}

export const IssueSavedRepliesPicker = forwardRef<HTMLButtonElement, Props>(function IssueSavedRepliesPicker({ tabIndex, onFocus, onKeyDown, onInsert }, ref) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<IssueSavedReply[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<IssueSavedReply | "new" | null>(null);
  const [deleting, setDeleting] = useState<IssueSavedReply | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const setTriggerRef = (node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  const filtered = replies.filter((reply) => reply.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const data = await savedReplyRequest("/api/issues/saved-replies");
      setReplies(Array.isArray(data) ? data.filter((item): item is IssueSavedReply => Boolean(item && typeof item === "object" && Number.isSafeInteger((item as IssueSavedReply).id) && typeof (item as IssueSavedReply).title === "string" && typeof (item as IssueSavedReply).body === "string")) : []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "加载保存回复失败"); }
    finally { setLoading(false); }
  };
  const close = () => { setOpen(false); setEditing(null); setDeleting(null); setError(null); requestAnimationFrame(() => triggerRef.current?.focus()); };
  const openPicker = () => { setOpen(true); setQuery(""); setEditing(null); setDeleting(null); void load(); requestAnimationFrame(() => searchRef.current?.focus()); };
  const beginEdit = (reply: IssueSavedReply | "new") => { setEditing(reply); setDeleting(null); setTitle(reply === "new" ? "" : reply.title); setBody(reply === "new" ? "" : reply.body); setError(null); };
  const save = async () => {
    setSaving(true); setError(null);
    try {
      const data = await savedReplyRequest(editing === "new" ? "/api/issues/saved-replies" : `/api/issues/saved-replies/${editing?.id}`, {
        method: editing === "new" ? "POST" : "PATCH", body: JSON.stringify({ title, body }),
      }) as IssueSavedReply;
      setReplies((current) => editing === "new" ? [data, ...current] : current.map((reply) => reply.id === data.id ? data : reply));
      setEditing(null);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "保存回复失败"); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setSaving(true); setError(null);
    try {
      await savedReplyRequest(`/api/issues/saved-replies/${deleting.id}`, { method: "DELETE" });
      setReplies((current) => current.filter((reply) => reply.id !== deleting.id)); setDeleting(null);
    } catch (removeError) { setError(removeError instanceof Error ? removeError.message : "删除保存回复失败"); }
    finally { setSaving(false); }
  };

  useEffect(() => { setActiveIndex(0); }, [query]);

  return <div className="relative shrink-0">
    <Button ref={setTriggerRef} type="button" variant="ghost" size="icon" tabIndex={tabIndex} aria-label="保存回复" aria-keyshortcuts="Control+." title="保存回复" className="h-11 w-11 sm:h-8 sm:w-8" onFocus={onFocus} onKeyDown={onKeyDown} onMouseDown={(event) => event.preventDefault()} onClick={() => open ? close() : openPicker()}><MessageSquareReply className="h-4 w-4" /></Button>
    {open && <div role="dialog" aria-label="保存回复" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }} className="absolute right-0 top-full z-50 mt-1 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xl">
      <header className="flex min-h-12 items-center gap-2 border-b px-3"><strong className="min-w-0 flex-1 text-sm">保存回复</strong><Button type="button" variant="ghost" size="icon" className="h-11 w-11 sm:h-8 sm:w-8" aria-label="关闭保存回复" onClick={close}><X className="h-4 w-4" /></Button></header>
      {editing ? <div className="space-y-3 p-3"><Input autoFocus aria-label="回复标题" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="回复标题" /><Textarea aria-label="回复正文" maxLength={20000} rows={7} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Markdown 回复正文；使用 %cursor% 指定插入后光标" />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => { setEditing(null); setError(null); }}>取消</Button><Button type="button" size="sm" className="h-11 sm:h-8" disabled={saving || !title.trim() || !body.trim()} onClick={() => void save()}>{saving ? "保存中..." : "保存回复"}</Button></div></div>
      : deleting ? <div className="space-y-3 p-3"><p className="text-sm">删除“{deleting.title}”？此操作无法撤销。</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button autoFocus type="button" variant="ghost" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => setDeleting(null)}>取消删除</Button><Button type="button" variant="destructive" size="sm" className="h-11 sm:h-8" disabled={saving} onClick={() => void remove()}>{saving ? "删除中..." : "确认删除"}</Button></div></div>
      : <><div className="flex gap-2 border-b p-2"><Input ref={searchRef} type="search" role="searchbox" aria-label="搜索保存回复" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (!filtered.length) return; if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); setActiveIndex(event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length); } else if (event.key === "Enter") { event.preventDefault(); onInsert(filtered[activeIndex] ?? filtered[0]); close(); } }} placeholder="搜索标题" /><Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" aria-label="新建保存回复" onClick={() => beginEdit("new")}><Plus className="h-4 w-4" /></Button></div>
        <div role="listbox" aria-label="保存回复列表" className="max-h-72 overflow-y-auto p-1">{loading ? <p role="status" className="px-3 py-4 text-sm text-muted-foreground">正在加载保存回复...</p> : error ? <div className="space-y-2 p-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => void load()}>重试</Button></div> : filtered.length === 0 ? <div className="space-y-2 px-3 py-4"><p className="text-sm text-muted-foreground">{replies.length ? "没有匹配的保存回复" : "尚未创建保存回复"}</p><Button type="button" variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => beginEdit("new")}>新建保存回复</Button></div> : filtered.map((reply, index) => <div key={reply.id} className={`group flex min-h-11 items-center gap-1 rounded ${index === activeIndex ? "bg-accent" : "hover:bg-muted"}`}><button type="button" role="option" aria-label={reply.title} aria-selected={index === activeIndex} className="min-h-11 min-w-0 flex-1 truncate px-3 text-left text-sm font-medium" onMouseEnter={() => setActiveIndex(index)} onClick={() => { onInsert(reply); close(); }}>{reply.title}</button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={`编辑 ${reply.title}`} onClick={() => beginEdit(reply)}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-destructive sm:h-8 sm:w-8" aria-label={`删除 ${reply.title}`} onClick={() => { setDeleting(reply); setError(null); }}><Trash2 className="h-3.5 w-3.5" /></Button></div>)}</div></>}
    </div>}
  </div>;
});
