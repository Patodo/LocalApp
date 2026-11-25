"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FolderCode, Settings2 } from "lucide-react";
import { Button } from "@localapp/ui/button";
import { Card, CardContent } from "@localapp/ui/card";
import { ChoiceSelect } from "@localapp/ui/choice-select";

type Project = { id: string; name: string };
type Provider = { id: string; name: string; model: string };

async function read(url: string) {
  const response = await fetch(url, { credentials: "include" });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || "加载失败");
  return result.data;
}

export function NativeDevelopmentEntry({ createAction }: { createAction?: ReactNode } = {}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [project, setProject] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([read("/api/development/projects"), read("/api/agent/settings")]).then(([projects, settings]) => {
      if (!active) return;
      setProjects(projects);
      setProviders(settings.providers);
      const requested = new URLSearchParams(window.location.search).get("projectId");
      setProject(projects.find((item: Project) => item.id === requested)?.id || projects[0]?.id || "");
      setProvider(settings.defaultProviderId || settings.providers[0]?.id || "");
      setReady(true);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "加载开发工作区失败"); });
    return () => { active = false; };
  }, []);

  const create = createAction ?? <Button asChild><a href="/my/apps">创建应用</a></Button>;

  return <section className="flex min-h-0 flex-1 flex-col gap-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight">应用开发</h1>
      {ready && project && create}
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!ready && !error && <p role="status" className="text-sm text-muted-foreground">正在加载开发工作区…</p>}
    {ready && !project && <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-col items-center gap-4 px-5 py-14 text-center">
        <FolderCode aria-hidden="true" className="size-10 rounded-lg bg-muted p-2 text-muted-foreground" />
        <div className="space-y-1">
          <h2 className="font-semibold">暂无源码项目</h2>
          <p className="text-sm text-muted-foreground">创建应用后，即可在这里选择项目和模型。</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {provider ? create : <Button asChild><a href="/my/models">模型与 Agent</a></Button>}
          <Button asChild variant="outline"><a href="/my/apps">我的应用</a></Button>
        </div>
      </CardContent>
    </Card>}
    {ready && project && <div className="flex flex-wrap items-center gap-2">
      <ChoiceSelect label="开发应用" value={project} options={projects.map(item => ({ value: item.id, label: item.name }))} onValueChange={setProject} />
      {providers.length > 0 && <ChoiceSelect label="开发模型" value={provider} options={providers.map(item => ({ value: item.id, label: `${item.name} · ${item.model}` }))} onValueChange={setProvider} />}
    </div>}
    {ready && project && !provider && <Card className="shadow-none"><CardContent className="space-y-3 px-5 py-6">
      <p className="text-sm text-muted-foreground">配置开发模型后即可打开工作区。</p>
      <Button asChild variant="outline"><a href="/my/models"><Settings2 />模型与 Agent</a></Button>
    </CardContent></Card>}
    {project && provider && <iframe key={`${project}:${provider}`} title="原生应用开发工作区" className="min-h-[26rem] w-full flex-1 rounded-lg border"
      src={`/api/development/projects/${encodeURIComponent(project)}/native/${encodeURIComponent(provider)}/`} />}
  </section>;
}
