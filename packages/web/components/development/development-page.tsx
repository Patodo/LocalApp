"use client";
import { useEffect, useRef, useState } from "react";
import { AppDevelopmentDock } from "./app-development-dock";
import { DshDevelopmentShell } from "./dsh-development-shell";
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
export function DevelopmentPage({
  application,
}: { application?: { owner: string; name: string } } = {}) {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [files, setFiles] = useState<string[]>([]),
    [file, setFile] = useState<FileValue | null>(null),
    [text, setText] = useState(""),
    [prompt, setPrompt] = useState(""),
    [messages, setMessages] = useState<any[]>([]),
    [sessions, setSessions] = useState<
      Array<{ id: string; createdAt: string; title?: string }>
    >([]),
    [live, setLive] = useState(""),
    [running, setRunning] = useState(false),
    [error, setError] = useState(""),
    [versions, setVersions] = useState<Version[]>([]),
    [version, setVersion] = useState(""),
    [changes, setChanges] = useState<any[]>([]),
    [interaction, setInteraction] = useState<any>(null),
    [answer, setAnswer] = useState(""),
    [providers, setProviders] = useState<any[]>([]),
    [provider, setProvider] = useState(""),
    [build, setBuild] = useState<any>(null),
    [log, setLog] = useState(""),
    [pending, setPending] = useState(false),
    [settingsReady, setSettingsReady] = useState(false);
  const [attachments, setAttachments] = useState<
    Array<{ id: string; name: string; size: number }>
  >([]);
  const diffBaseline = useRef("");
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
      setSettingsReady(true);
    });
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (!settingsReady) return;
    if (!application) {
      const requestedId = new URLSearchParams(window.location.search).get(
        "projectId",
      );
      const requested = projects.find((p) => p.id === requestedId);
      if (requested) select(requested);
      return;
    }
    void act(async () => {
      const p = await request(
        `/api/development/apps/${encodeURIComponent(application.owner)}/${encodeURIComponent(application.name)}/source`,
      );
      if (p) select(p);
    });
  }, [application?.owner, application?.name, settingsReady]);
  const View = application ? AppDevelopmentDock : DshDevelopmentShell;
  async function refresh(id: string) {
    const b = `/api/development/projects/${id}`;
    setFiles(await request(b + "/files"));
    const v = await request(b + "/versions");
    setVersions(v);
    setVersion(v[0]?.id ?? "");
    if (!diffBaseline.current) diffBaseline.current = v[0]?.id ?? "";
  }
  function select(p: Project) {
    selection.current++;
    abort.current?.abort();
    setProject(p);
    setAttachments([]);
    diffBaseline.current = "";
    setFile(null);
    setText("");
    setMessages([]);
    setSessions([]);
    setLive("");
    setBuild(null);
    setLog("");
    setChanges([]);
    session.current = "";
    void act(async () => {
      await refresh(p.id);
      const builds = await request(`/api/development/projects/${p.id}/builds`);
      setBuild(builds[0] ?? null);
      if (builds[0]?.sourceVersion)
        diffBaseline.current = builds[0].sourceVersion;
      setLog(builds[0]?.log ?? "");
      if (provider) {
        const sessions = await request(
          `/api/development/projects/${p.id}/agent/sessions`,
        );
        setSessions(sessions);
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
  }
  async function save() {
    if (!file) return;
    const updated = await request(base + "/file", "PUT", {
      path: file.path,
      hash: file.hash,
      content: text,
    });
    setFile(updated);
    setBuild(null);
    await refresh(project!.id);
  }
  async function run() {
    if (!project || !prompt.trim() || running) return;
    if (file && file.content !== text) await save();
    setBuild(null);
    setRunning(true);
    setError("");
    setLive("");
    setInteraction(null);
    const controller = new AbortController();
    abort.current = controller;
    const submitted = prompt;
    const submittedAttachments = attachments;
    setPrompt("");
    try {
      const res = await fetch(base + "/agent/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: submitted,
          attachmentIds: submittedAttachments.map((file) => file.id),
          providerId: provider,
          ...(session.current ? { sessionId: session.current } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error);
      }
      setAttachments([]);
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
            if (e.type === "session_title" && e.title) {
              setSessions(rows => rows.some(row => row.id === e.sessionId)
                ? rows.map(row => row.id === e.sessionId ? { ...row, title: e.title } : row)
                : [...rows, { id: e.sessionId, createdAt: new Date().toISOString(), title: e.title }]);
            }
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
      setSessions(await request(base + "/agent/sessions"));
      if (file) await open(file.path);
    }
  }
  useEffect(() => {
    if (!project || !sessions.length) return;
    // Auxiliary title generation can finish after the main conversation stream.
    let active = true;
    let attempts = 0;
    const timer = setInterval(async () => {
      try {
        const rows = await request(base + "/agent/sessions");
        if (active) setSessions(rows);
      } catch { /* Keep the last known titles when the Server is unavailable. */ }
      if (++attempts >= 10) clearInterval(timer);
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [project?.id, running]);
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
    setLog(b.log ?? "");
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
    <View
      {...(application
        ? {
            application,
            importSource: async (files: Record<string, string>) => {
              const p = await request(
                `/api/development/apps/${encodeURIComponent(application.owner)}/${encodeURIComponent(application.name)}/source`,
                "POST",
                { files },
              );
              setProjects((x) => [p, ...x]);
              select(p);
            },
          }
        : {})}
      attachments={attachments}
      sessions={sessions}
      selectedSession={session.current}
      projects={projects}
      project={project}
      files={files}
      file={file}
      text={text}
      prompt={prompt}
      messages={messages}
      live={live}
      running={running}
      pending={pending}
      error={error}
      versions={versions}
      version={version}
      changes={changes}
      providers={providers}
      provider={provider}
      build={build}
      log={log}
      interaction={interaction}
      answer={answer}
      actions={{
        upload: (files) =>
          void act(async () => {
            if (!files?.length || !project || running) return;
            if (attachments.length + files.length > 10)
              throw new Error("每次最多发送 10 个附件");
            for (const file of Array.from(files)) {
              const body = new FormData();
              body.append("file", file);
              const response = await fetch(base + "/attachments", {
                method: "POST",
                credentials: "include",
                body,
              });
              const result = await response.json();
              if (!response.ok || !result.success)
                throw new Error(result.error ?? "上传失败");
              setAttachments((current) => [...current, result.data]);
            }
          }),
        removeAttachment: (id) =>
          setAttachments((current) => current.filter((file) => file.id !== id)),
        select,
        selectSession: (id) =>
          void act(async () => {
            if (running) return;
            const history = await request(
              base + `/agent/history?sessionId=${encodeURIComponent(id)}`,
            );
            session.current = id;
            setMessages(history);
            setLive("");
          }),
        create: (name) =>
          void act(async () => {
            const p = await request("/api/development/projects", "POST", {
              name,
            });
            setProjects((x) => [p, ...x]);
            select(p);
          }),
        open: (path) => void act(() => open(path)),
        setText,
        save: () => void act(save),
        setPrompt,
        run: () => void act(run),
        stop: () => void act(stop),
        setProvider,
        newSession: () => {
          if (running) return;
          session.current = "";
          setAttachments([]);
          setMessages([]);
          setLive("");
          setPrompt("");
        },
        setVersion,
        diff: () =>
          void act(async () => {
            setChanges(
              await request(
                base +
                  `/diff?version=${application ? diffBaseline.current : version}`,
              ),
            );
          }),
        restore: () =>
          void act(async () => {
            if (
              !window.confirm(
                "恢复这个源码版本？当前改动会自动保存。正式应用不会改变。",
              )
            )
              return;
            await request(base + "/restore", "POST", { version });
            await refresh(project!.id);
            setFile(null);
            setText("");
          }),
        build: () => void act(buildProject),
        preview: () =>
          void act(async () => {
            const preview = await request(base + "/previews", "POST", {
              buildId: build.id,
            });
            window.open(preview.url, "_blank", "noopener");
          }),
        publish: () =>
          void act(async () => {
            const expected = await request(base + "/release-target");
            if (
              !window.confirm(
                `发布 ${project!.name} 的这次构建？当前源码后续的修改不会包含在内。`,
              )
            )
              return;
            const result = await request(base + "/releases", "POST", {
              buildId: build.id,
              expectedVersion: expected.version,
              idempotencyKey: build.id,
            });
            setLog((x) => x + "\n已发布：" + result.url);
            if (application) window.location.reload();
          }),
        cancelBuild: () =>
          void act(async () => {
            await request(base + `/builds/${build.id}/cancel`, "POST", {});
          }),
        newFile: (path) =>
          void act(async () => {
            await request(base + "/file", "PUT", {
              path,
              content: "",
              hash: null,
            });
            await refresh(project!.id);
            await open(path);
          }),
        respond: (result) => void act(() => respond(result)),
        setAnswer,
      }}
    />
  );
}
