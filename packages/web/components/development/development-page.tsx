"use client";
import { useEffect, useRef, useState } from "react";
import {
  Code2,
  FileCode,
  Play,
  Save,
  Square,
  RotateCcw,
  Plus,
  Rocket,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DshDiff, DshMarkdown, DshMessages, DshTerminal } from "./dsh-view";
type Project = { id: string; name: string };
type Version = { id: string; message: string };
type FileValue = { path: string; content: string; hash: string };
async function request(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error ?? "请求失败");
  return json.data;
}
export function DevelopmentPage() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [name, setName] = useState(""),
    [files, setFiles] = useState<string[]>([]),
    [file, setFile] = useState<FileValue | null>(null),
    [text, setText] = useState(""),
    [prompt, setPrompt] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [live, setLive] = useState(""),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [versions, setVersions] = useState<Version[]>([]),
    [version, setVersion] = useState(""),
    [changes, setChanges] = useState<any[]>([]),
    [tab, setTab] = useState("source"),
    [interaction, setInteraction] = useState<any>(null),
    [answer, setAnswer] = useState(""),
    [providers, setProviders] = useState<any[]>([]),
    [provider, setProvider] = useState(""),
    [build, setBuild] = useState<any>(null),
    [log, setLog] = useState(""),
    [pending, setPending] = useState(false),
    [newPath, setNewPath] = useState("");
  const session = useRef(""),
    abort = useRef<AbortController | null>(null),
    selection = useRef(0);
  const base = project ? `/api/development/projects/${project.id}` : "";
  const act = async (fn: () => Promise<void>) => {
    setError("");
    setPending(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    void act(async () => {
      setProjects(await request("/api/development/projects"));
      const settings = await request("/api/agent/settings");
      setProviders(settings.providers);
      setProvider(settings.defaultProviderId);
    });
    return () => abort.current?.abort();
  }, []);
  async function refresh(id: string) {
    const b = `/api/development/projects/${id}`;
    setFiles(await request(b + "/files"));
    const v = await request(b + "/versions");
    setVersions(v);
    setVersion(v[0]?.id ?? "");
  }
  function select(p: Project) {
    selection.current++;
    abort.current?.abort();
    setProject(p);
    setFile(null);
    setText("");
    setMessages([]);
    setLive("");
    setBuild(null);
    setLog("");
    setChanges([]);
    session.current = "";
    void act(async () => {
      await refresh(p.id);
      const builds = await request(`/api/development/projects/${p.id}/builds`);
      setBuild(builds[0] ?? null);
      setLog(builds[0]?.log ?? "");
      if (provider) {
        const sessions = await request(
          `/api/development/projects/${p.id}/agent/sessions`,
        );
        if (sessions.length) {
          session.current = sessions[sessions.length - 1].id;
          setMessages(
            await request(
              `/api/development/projects/${p.id}/agent/history?sessionId=${encodeURIComponent(session.current)}`,
            ),
          );
        }
      }
    });
  }
  async function open(path: string) {
    const seq = ++selection.current;
    const f = await request(base + `/file?path=${encodeURIComponent(path)}`);
    if (seq !== selection.current) return;
    setFile(f);
    setText(f.content);
    setTab("source");
  }
  async function save() {
    if (!file) return;
    const updated = await request(base + "/file", "PUT", {
      path: file.path,
      hash: file.hash,
      content: text,
    });
    setFile(updated);
    await refresh(project!.id);
  }
  async function run() {
    if (!project || !prompt.trim() || running) return;
    if (file && file.content !== text) await save();
    setRunning(true);
    setError("");
    setLive("");
    setInteraction(null);
    const controller = new AbortController();
    abort.current = controller;
    const submitted = prompt;
    setPrompt("");
    try {
      const res = await fetch(base + "/agent/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: submitted,
          providerId: provider,
          ...(session.current ? { sessionId: session.current } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error);
      }
      const reader = res.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const part = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const e = JSON.parse(line.slice(6));
            if (e.type === "session") session.current = e.sessionId;
            if (e.type === "messages") {
              setMessages(e.messages);
              setLive("");
            }
            if (e.type === "text_delta")
              setLive((x) => x + (e.delta ?? e.text ?? ""));
            if (e.type === "interaction") setInteraction(e);
            if (e.type === "error") setError(e.message);
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setRunning(false);
      setInteraction(null);
      await refresh(project.id);
      if (file) await open(file.path);
    }
  }
  async function stop() {
    await request(base + "/agent/cancel", "POST", {
      sessionId: session.current,
    });
    abort.current?.abort();
  }
  async function respond(result: unknown) {
    await request(base + "/agent/respond", "POST", {
      token: interaction.token,
      result,
    });
    setInteraction(null);
    setAnswer("");
  }
  async function buildProject() {
    if (file && text !== file.content) await save();
    const b = await request(base + "/builds", "POST", {});
    setBuild(b);
    setTab("build");
  }
  useEffect(() => {
    if (!build || !["queued", "running"].includes(build.status)) return;
    const timer = setInterval(() => {
      void request(base + `/builds/${build.id}`)
        .then((b) => {
          setBuild(b);
          setLog(b.log ?? "");
        })
        .catch((e) => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [base, build]);
  return (
    <div className="dsh-development space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Code2 className="h-6 w-6" />
        <h1 className="text-xl font-semibold">应用开发</h1>
        <select
          aria-label="开发项目"
          disabled={running || pending}
          className="rounded border bg-background p-2"
          value={project?.id ?? ""}
          onChange={(e) => {
            const p = projects.find((p) => p.id === e.target.value);
            if (p) select(p);
          }}
        >
          <option value="">选择项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input
          aria-label="新项目名称"
          placeholder="my-app"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-44"
        />
        <Button
          disabled={pending || running || !name}
          onClick={() =>
            void act(async () => {
              const p = await request("/api/development/projects", "POST", {
                name,
              });
              setProjects((x) => [p, ...x]);
              setName("");
              select(p);
            })
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          创建
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded border border-destructive p-3 text-destructive"
        >
          {error}
        </div>
      )}
      {!project ? (
        <p className="text-muted-foreground">
          从 builtin 模板创建项目，在网页中让 Agent
          修改源码、查看改动并构建应用。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setTab("source")}>
              源码
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void act(async () => {
                  setChanges(await request(base + `/diff?version=${version}`));
                  setTab("changes");
                })
              }
            >
              改动
            </Button>
            <Button
              disabled={running || pending}
              onClick={() => void act(buildProject)}
            >
              <Play className="mr-1 h-4 w-4" />
              构建
            </Button>
            {build && (
              <>
                <Button variant="outline" onClick={() => setTab("build")}>
                  构建记录
                </Button>
                <Button
                  variant="outline"
                  disabled={build.status !== "succeeded"}
                  onClick={() =>
                    void act(async () => {
                      const preview = await request(
                        base + "/previews",
                        "POST",
                        { buildId: build.id },
                      );
                      window.open(preview.url, "_blank", "noopener");
                    })
                  }
                >
                  <Eye className="mr-1 h-4 w-4" />
                  预览
                </Button>
                <Button
                  disabled={running || build.status !== "succeeded"}
                  onClick={() =>
                    void act(async () => {
                      const expected = await request(base + "/release-target");
                      if (
                        !window.confirm(
                          `发布 ${project.name} 的这次构建？当前源码后续的修改不会包含在内。`,
                        )
                      )
                        return;
                      const result = await request(base + "/releases", "POST", {
                        buildId: build.id,
                        expectedVersion: expected.version,
                        idempotencyKey: build.id,
                      });
                      setLog((x) => x + "\n已发布：" + result.url);
                      setTab("build");
                    })
                  }
                >
                  <Rocket className="mr-1 h-4 w-4" />
                  发布
                </Button>
              </>
            )}
            <select
              aria-label="源码版本"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="max-w-64 rounded border bg-background p-2"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.message} · {v.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={running || !version}
              onClick={() =>
                void act(async () => {
                  if (
                    !window.confirm(
                      "恢复这个源码版本？当前改动会自动保存。正式应用不会改变。",
                    )
                  )
                    return;
                  await request(base + "/restore", "POST", { version });
                  await refresh(project.id);
                  setFile(null);
                  setText("");
                })
              }
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              恢复源码
            </Button>
          </div>
          <div className="grid min-h-[65vh] gap-4 xl:grid-cols-[180px_minmax(0,1fr)_minmax(300px,0.8fr)]">
            <aside className="max-h-[65vh] overflow-auto rounded-lg border p-2">
              <div className="mb-2 font-medium">项目文件</div>
              <Input
                aria-label="新文件路径"
                placeholder="src/new.ts"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={running || !newPath}
                onClick={() =>
                  void act(async () => {
                    await request(base + "/file", "PUT", {
                      path: newPath,
                      content: "",
                      hash: null,
                    });
                    await refresh(project.id);
                    await open(newPath);
                    setNewPath("");
                  })
                }
              >
                新建文件
              </Button>
              {files.map((f) => (
                <button
                  key={f}
                  className={`flex w-full items-center gap-1 rounded p-1 text-left text-xs ${file?.path === f ? "bg-accent" : ""}`}
                  onClick={() => void act(() => open(f))}
                >
                  <FileCode className="h-3 w-3 shrink-0" />
                  <span className="break-all">{f}</span>
                </button>
              ))}
            </aside>
            <section className="min-w-0 rounded-lg border p-3">
              {tab === "source" ? (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="truncate text-sm">
                      {file?.path ?? "选择文件"}
                      {file && text !== file.content ? " · 未保存" : ""}
                    </span>
                    <Button
                      size="sm"
                      disabled={
                        !file || running || pending || text === file.content
                      }
                      onClick={() => void act(save)}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      保存
                    </Button>
                  </div>
                  <Textarea
                    aria-label="源码编辑器"
                    spellCheck={false}
                    readOnly={running || !file}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="min-h-[55vh] font-mono text-xs"
                  />
                </>
              ) : tab === "changes" ? (
                <>
                  {changes.length ? (
                    <DshDiff changes={changes} />
                  ) : (
                    <p>当前没有改动</p>
                  )}
                </>
              ) : (
                <>
                  <p>构建状态：{build?.status ?? "尚未构建"}</p>
                  <DshTerminal
                    command="localapp check / build"
                    output={log}
                    running={build?.status === "running"}
                  />
                  {build?.status === "running" && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void act(async () => {
                          await request(
                            base + `/builds/${build.id}/cancel`,
                            "POST",
                            {},
                          );
                        })
                      }
                    >
                      停止构建
                    </Button>
                  )}
                </>
              )}
            </section>
            <section className="flex min-w-0 flex-col rounded-lg border p-3">
              <div className="mb-3 flex items-center gap-2">
                <span className="font-medium">开发 Agent</span>
                <select
                  aria-label="模型供应商"
                  disabled={running}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="min-w-0 rounded border bg-background p-1 text-sm"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </option>
                  ))}
                </select>
                <a href="/my/models" className="text-xs text-primary">
                  设置
                </a>
              </div>
              <div className="max-h-[48vh] flex-1 overflow-auto">
                <DshMessages messages={messages} />
                {live && <DshMarkdown text={live} streaming />}
                {running && (
                  <p className="text-sm text-muted-foreground">
                    Agent 正在工作，源码编辑暂时锁定。
                  </p>
                )}
              </div>
              {interaction && (
                <div className="my-2 rounded border p-2">
                  {interaction.kind === "approval" ? (
                    <>
                      <p>
                        {interaction.toolName}：{interaction.reason}
                      </p>
                      <Button
                        onClick={() => void act(() => respond("allowed-once"))}
                      >
                        允许本次
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void act(() => respond("rejected"))}
                      >
                        拒绝
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        {interaction.questions
                          ?.map((q: any) => q.question)
                          .join("\n")}
                      </p>
                      <Input
                        aria-label="回答 Agent"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                      />
                      <Button
                        onClick={() =>
                          void act(() =>
                            respond(
                              Object.fromEntries(
                                interaction.questions.map((q: any) => [
                                  q.id,
                                  answer,
                                ]),
                              ),
                            ),
                          )
                        }
                      >
                        回答
                      </Button>
                    </>
                  )}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(run);
                }}
                className="mt-3 space-y-2"
              >
                <Textarea
                  aria-label="开发需求"
                  placeholder="描述你希望应用实现的功能…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={running}
                />
                <div className="flex gap-2">
                  <Button
                    disabled={!provider || running || !prompt.trim()}
                    type="submit"
                  >
                    开始开发
                  </Button>
                  {running && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void act(stop)}
                    >
                      <Square className="mr-1 h-4 w-4" />
                      停止
                    </Button>
                  )}
                </div>
              </form>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
