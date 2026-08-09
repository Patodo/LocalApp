"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Task = { id: string; workspaceId: string; kind: string; executable: string; args: string[]; timeoutMs: number; status: string; error: string | null };
type Workspace = { id: string; name: string };

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || `HTTP ${response.status}`);
  return body.data as T;
}

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<Record<string, string>>({});
  const streams = useRef(new Map<string, EventSource>());

  useEffect(() => {
    void Promise.all([
      requestJson<Task[]>("/api/tasks"), requestJson<Workspace[]>("/api/workspaces"), requestJson<{ id: string; role?: string }>("/api/me"),
    ]).then(([loadedTasks, loadedWorkspaces, me]) => { setTasks(loadedTasks); setWorkspaces(loadedWorkspaces); setWorkspaceId(loadedWorkspaces[0]?.id ?? ""); setIsAdmin(me.role === "admin"); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "加载任务失败"));
  }, []);

  const runningTaskIds = tasks.filter((task) => task.status === "running").map((task) => task.id).sort().join("\0");

  useEffect(() => {
    const runningIds = new Set(tasks.filter((task) => task.status === "running").map((task) => task.id));
    for (const task of tasks) {
      if (task.status !== "running" || streams.current.has(task.id)) continue;
      const stream = new EventSource(`/api/tasks/${encodeURIComponent(task.id)}/events`);
      stream.addEventListener("log", (event) => {
        const data = JSON.parse(event.data) as { content?: string };
        if (data.content) setLogs((current) => ({ ...current, [task.id]: `${current[task.id] ?? ""}${data.content}` }));
      });
      stream.addEventListener("status", (event) => {
        const data = JSON.parse(event.data) as Task;
        setTasks((current) => current.map((item) => item.id === task.id ? data : item));
      });
      streams.current.set(task.id, stream);
    }
    for (const [taskId, stream] of streams.current) {
      if (runningIds.has(taskId)) continue;
      stream.close();
      streams.current.delete(taskId);
    }
  }, [runningTaskIds]);

  useEffect(() => () => {
    for (const stream of streams.current.values()) stream.close();
    streams.current.clear();
  }, []);

  const startBuild = async () => {
    try {
      const task = await requestJson<Task>("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, kind: "build", executable: "npm", args: ["run", "build"], timeoutMs: 900000 }) });
      setTasks((current) => [task, ...current]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "启动任务失败"); }
  };
  const cancel = async (id: string) => {
    try { const task = await requestJson<Task>(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }); setTasks((current) => current.map((item) => item.id === id ? task : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "取消任务失败"); }
  };

  return <div className="space-y-6"><header><h1 className="text-2xl font-bold">任务</h1><p className="mt-1 text-sm text-muted-foreground">构建、测试、Git 与 Agent 执行会访问宿主环境，因此在容器隔离可用前仅管理员可启动。</p></header>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {isAdmin ? <section className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"><div className="space-y-2"><Label htmlFor="task-workspace">工作区</Label><select id="task-workspace" aria-label="工作区" className="flex h-9 rounded-md border bg-transparent px-3 text-sm" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></div><Button onClick={() => void startBuild()} disabled={!workspaceId}><Hammer className="mr-1 size-4" />启动构建</Button></section> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">只有管理员可以启动新任务；你仍可查看和取消自己拥有的任务。</p>}
    <section className="space-y-2">{tasks.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">暂无任务</p> : tasks.map((task) => <article key={task.id} className="rounded-lg border bg-card p-4"><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-sm">{task.id}</p><p className="text-sm text-muted-foreground">{task.kind}: {task.executable} {task.args.join(" ")} · {task.status}</p></div>{task.status === "running" && <Button variant="outline" size="sm" onClick={() => void cancel(task.id)} aria-label={`取消任务 ${task.id}`}><Ban className="mr-1 size-4" />取消</Button>}</div>{logs[task.id] && <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{logs[task.id]}</pre>}{task.error && <p className="mt-2 text-sm text-destructive">{task.error}</p>}</article>)}</section>
  </div>;
}
