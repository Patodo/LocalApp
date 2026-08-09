"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { FilePenLine, FolderPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Workspace = { id: string; ownerId: string; name: string; createdAt: string; updatedAt: string };

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
  return body.data as T;
}

export function StudioPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [importName, setImportName] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [filePath, setFilePath] = useState("");
  const [content, setContent] = useState("");
  const [loadedPath, setLoadedPath] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedWorkspace = useRef<Workspace | null>(null);
  const selectedFilePath = useRef("");
  const readVersion = useRef(0);

  const load = async () => {
    try { setWorkspaces(await requestJson<Workspace[]>("/api/workspaces")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "加载工作区失败"); }
  };
  useEffect(() => { void load(); }, []);

  const create = async () => {
    try {
      const workspace = await requestJson<Workspace>("/api/workspaces", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workspaceName }) });
      setWorkspaces((current) => [workspace, ...current]); setWorkspaceName(""); setMessage("工作区已创建");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建工作区失败"); }
  };
  const importArchive = async () => {
    if (!archive) { setError("请选择工作区归档"); return; }
    const form = new FormData(); form.set("name", importName); form.set("archive", archive);
    try {
      const workspace = await requestJson<Workspace>("/api/workspaces/import", { method: "POST", body: form });
      setWorkspaces((current) => [workspace, ...current]); setImportName(""); setArchive(null); setMessage("工作区已导入");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "导入工作区失败"); }
  };
  const saveFile = async () => {
    if (!selected || loadedPath !== filePath) return;
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(selected.id)}/file`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: filePath, content }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `HTTP ${response.status}`); }
      setMessage("文件已保存");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存文件失败"); }
  };

  const chooseWorkspace = (workspace: Workspace) => {
    readVersion.current += 1;
    selectedWorkspace.current = workspace;
    selectedFilePath.current = "";
    setSelected(workspace);
    setFilePath("");
    setContent("");
    setLoadedPath("");
    setError("");
  };

  const changeFilePath = (path: string) => {
    readVersion.current += 1;
    selectedFilePath.current = path;
    setFilePath(path);
    setContent("");
    setLoadedPath("");
  };

  const readFile = async () => {
    const workspace = selectedWorkspace.current;
    const path = selectedFilePath.current;
    if (!workspace || !path.trim()) return;
    const version = ++readVersion.current;
    setError("");
    try {
      const file = await requestJson<{ path: string; content: string }>(`/api/workspaces/${encodeURIComponent(workspace.id)}/file?path=${encodeURIComponent(path)}`);
      if (readVersion.current !== version || selectedWorkspace.current?.id !== workspace.id || selectedFilePath.current !== path) return;
      selectedFilePath.current = file.path;
      setFilePath(file.path);
      setContent(file.content);
      setLoadedPath(file.path);
    } catch (cause) {
      if (readVersion.current === version && selectedWorkspace.current?.id === workspace.id && selectedFilePath.current === path) {
        setError(cause instanceof Error ? cause.message : "读取文件失败");
      }
    }
  };

  return <div className="space-y-8">
    <header><h1 className="text-2xl font-bold">Studio</h1><p className="mt-1 text-sm text-muted-foreground">管理自己拥有的工作区和文件。构建、上传及自动化执行仅管理员可用。</p></header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p className="text-sm text-emerald-700">{message}</p>}
    <section className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div className="space-y-3"><h2 className="flex items-center gap-2 font-semibold"><FolderPlus className="size-4" />新建工作区</h2><Label htmlFor="workspace-name">工作区名称</Label><Input id="workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /><Button onClick={() => void create()} disabled={!workspaceName.trim()}>创建工作区</Button></div>
      <div className="space-y-3"><h2 className="flex items-center gap-2 font-semibold"><Upload className="size-4" />导入归档</h2><Label htmlFor="import-name">导入工作区名称</Label><Input id="import-name" value={importName} onChange={(event) => setImportName(event.target.value)} /><Label htmlFor="workspace-archive">工作区归档</Label><Input id="workspace-archive" type="file" accept=".zip,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => setArchive(event.target.files?.[0] ?? null)} /><Button variant="outline" onClick={() => void importArchive()} disabled={!importName.trim() || !archive}>导入归档</Button></div>
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">我的工作区</h2>{workspaces.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无工作区</p> : <div className="space-y-2">{workspaces.map((workspace) => <div key={workspace.id} className="flex items-center justify-between rounded-lg border bg-card p-4"><div><p className="font-medium">{workspace.name}</p><p className="text-xs text-muted-foreground">更新于 {new Date(workspace.updatedAt).toLocaleString()}</p></div><Button variant="outline" size="sm" onClick={() => chooseWorkspace(workspace)}><FilePenLine className="mr-1 size-4" />编辑 {workspace.name}</Button></div>)}</div>}</section>
    {selected && <section className="space-y-3 rounded-xl border bg-card p-4"><h2 className="text-lg font-semibold">编辑 {selected.name}</h2><div className="flex gap-2"><div className="min-w-0 flex-1 space-y-2"><Label htmlFor="file-path">文件路径</Label><Input id="file-path" value={filePath} onChange={(event) => changeFilePath(event.target.value)} placeholder="src/app.tsx" /></div><Button className="mt-7" variant="outline" onClick={() => void readFile()} disabled={!filePath.trim()}>读取文件</Button></div><div className="space-y-2"><Label htmlFor="file-content">文件内容</Label><Textarea id="file-content" value={content} onChange={(event) => setContent(event.target.value)} rows={12} disabled={loadedPath !== filePath} /></div><Button onClick={() => void saveFile()} disabled={!filePath.trim() || loadedPath !== filePath}>保存文件</Button></section>}
  </div>;
}
