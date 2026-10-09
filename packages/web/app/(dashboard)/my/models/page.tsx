"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Provider { id: string; name: string; protocol: string; baseUrl: string; model: string; apiKey?: string; hasApiKey?: boolean }
interface McpServer { serverName: string; transport?: "streamable-http" | "stdio"; url?: string; headers?: Record<string, string>; hasHeaders?: boolean; command?: string; args?: string[]; env?: Record<string, string>; hasEnv?: boolean; hasArgs?: boolean; hasUrlQuery?: boolean }
interface Settings { providers: Provider[]; defaultProviderId: string; grants: Record<string, string[]>; mcpServers: McpServer[] }
const capabilities: Record<string, string> = { files: "工作区文件", terminal: "Server 终端", mcp: "MCP", skills: "Skills", subagents: "子 Agent", jobs: "后台任务", web: "网页访问", workflow: "工作流", schedule: "定时任务" };

export default function AgentModelSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [appId, setAppId] = useState("");
  const [error, setError] = useState("");
  const [mcpArguments, setMcpArguments] = useState<Record<number, string>>({});
  const [mcpEnvironment, setMcpEnvironment] = useState<Record<number, string>>({});
  useEffect(() => { fetch("/api/agent/settings", { credentials: "include" }).then((r) => r.json()).then((body) => { if (!body.success) throw new Error(body.error); setSettings(body.data); }).catch((e) => setError(e.message)); }, []);
  const updateProvider = (id: string, patch: Partial<Provider>) => setSettings((current) => current && ({ ...current, providers: current.providers.map((p) => p.id === id ? { ...p, ...patch } : p) }));
  const save = async () => {
    setSaving(true); setError("");
    try {
      const payload = { ...settings, mcpServers: settings?.mcpServers.map((server, index) => server.transport === "stdio" ? { ...server, args: !mcpArguments[index] ? server.hasArgs ? undefined : server.args ?? [] : JSON.parse(mcpArguments[index]), env: !mcpEnvironment[index] ? server.env : JSON.parse(mcpEnvironment[index]) } : server) };
      const response = await fetch("/api/agent/settings", { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "保存失败");
      setSettings(body.data); setMcpArguments({}); setMcpEnvironment({}); toast.success("模型与 Agent 设置已保存");
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  if (!settings) return <p role={error ? "alert" : "status"}>{error || "加载中..."}</p>;
  return <div className="max-w-3xl space-y-6">
    <h1 className="text-2xl font-bold">模型与 Agent</h1>
    <p className="text-sm text-muted-foreground">应用使用你选择的供应商和模型。凭据保存在此 Server，其他用户和应用不会收到你的 API Key。</p>
    <div className="space-y-4"><h2 className="text-lg font-semibold">模型供应商</h2>
      {settings.providers.map((provider, index) => <fieldset key={provider.id} className="space-y-3 rounded-xl border p-4"><legend className="px-1">供应商 {index + 1}</legend>
        <Label htmlFor={`provider-name-${provider.id}`}>名称</Label><Input id={`provider-name-${provider.id}`} value={provider.name} onChange={(e) => updateProvider(provider.id, { name: e.target.value })} />
        <Label htmlFor={`provider-protocol-${provider.id}`}>接口协议</Label><select id={`provider-protocol-${provider.id}`} className="block w-full rounded border p-2" value={provider.protocol} onChange={(e) => updateProvider(provider.id, { protocol: e.target.value })}>
          <option value="openai-completions">OpenAI Chat Completions / DeepSeek / 兼容接口</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="google-generative-ai">Google Gemini</option>
        </select>
        <Label htmlFor={`provider-url-${provider.id}`}>API 地址</Label><Input id={`provider-url-${provider.id}`} type="url" placeholder="https://api.deepseek.com/v1" value={provider.baseUrl} onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })} />
        <Label htmlFor={`provider-model-${provider.id}`}>模型名称</Label><Input id={`provider-model-${provider.id}`} value={provider.model} onChange={(e) => updateProvider(provider.id, { model: e.target.value })} />
        <Label htmlFor={`provider-key-${provider.id}`}>API Key</Label><Input id={`provider-key-${provider.id}`} type="password" autoComplete="new-password" placeholder={provider.hasApiKey ? "已保存，留空保留" : "填写 API Key"} value={provider.apiKey ?? ""} onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value || undefined })} />
        <div className="flex items-center justify-between"><label><input type="radio" name="default-provider" checked={settings.defaultProviderId === provider.id} onChange={() => setSettings({ ...settings, defaultProviderId: provider.id })} /> 默认供应商</label>
          <Button variant="ghost" aria-label={`删除供应商 ${index + 1}`} onClick={() => setSettings({ ...settings, providers: settings.providers.filter((p) => p.id !== provider.id), defaultProviderId: settings.defaultProviderId === provider.id ? "" : settings.defaultProviderId })}><Trash2 className="h-4 w-4" /></Button></div>
      </fieldset>)}
      <Button variant="outline" onClick={() => { const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""); setSettings({ ...settings, defaultProviderId: settings.defaultProviderId || id, providers: [...settings.providers, { id, name: "", protocol: "openai-completions", baseUrl: "https://api.deepseek.com/v1", model: "", apiKey: "" }] }); }}><Plus className="mr-2 h-4 w-4" />添加供应商</Button>
    </div>
    <section className="space-y-3"><h2 className="text-lg font-semibold">应用可用能力</h2>
      <p className="text-sm text-muted-foreground">应用需要在 manifest.json 中声明能力，你在这里允许后才会启用。终端与工作流在 Server 主机执行代码；只允许你信任的应用。页面工具始终按你的应用权限执行。</p>
      <div className="flex gap-2"><Input aria-label="应用地址" placeholder="用户名/应用名" value={appId} onChange={(e) => setAppId(e.target.value)} /><Button variant="outline" onClick={() => { if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(appId)) { setError("请填写 用户名/应用名"); return; } setSettings({ ...settings, grants: { ...settings.grants, [appId]: settings.grants[appId] ?? [] } }); setAppId(""); }}>添加应用</Button></div>
      {Object.entries(settings.grants).map(([id, enabled]) => <fieldset key={id} className="rounded border p-3"><legend>{id}</legend><div className="flex flex-wrap gap-3">{Object.entries(capabilities).map(([key, label]) => <label key={key}><input type="checkbox" checked={enabled.includes(key)} onChange={(e) => setSettings({ ...settings, grants: { ...settings.grants, [id]: e.target.checked ? [...enabled, key] : enabled.filter((c) => c !== key) } })} /> {label}</label>)}<button aria-label={`删除应用授权 ${id}`} onClick={() => { const grants = { ...settings.grants }; delete grants[id]; setSettings({ ...settings, grants }); }}><Trash2 className="h-4 w-4" /></button></div></fieldset>)}
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">MCP 服务</h2>
      {settings.mcpServers.map((server, index) => <div key={index} className="space-y-2 rounded border p-3">
        <Input aria-label={`MCP 名称 ${index + 1}`} placeholder="名称" value={server.serverName} onChange={(e) => setSettings({ ...settings, mcpServers: settings.mcpServers.map((s, i) => i === index ? { ...s, serverName: e.target.value } : s) })} />
        <select aria-label={`MCP 连接方式 ${index + 1}`} value={server.transport ?? "streamable-http"} onChange={(e) => setSettings({ ...settings, mcpServers: settings.mcpServers.map((s, i) => i === index ? { ...s, transport: e.target.value as McpServer["transport"], args: s.args } : s) })}><option value="streamable-http">Streamable HTTP</option><option value="stdio">本机 stdio（在应用工作区运行）</option></select>
        {server.transport === "stdio" ? <>
          <Input aria-label={`MCP 命令 ${index + 1}`} placeholder="命令，例如 npx" value={server.command ?? ""} onChange={(e) => setSettings({ ...settings, mcpServers: settings.mcpServers.map((s, i) => i === index ? { ...s, command: e.target.value } : s) })} />
          <Input aria-label={`MCP 参数 ${index + 1}`} placeholder={server.hasArgs ? "参数已保存，留空保留（JSON 数组）" : 'JSON 数组，例如 ["-y", "服务包名"]'} value={mcpArguments[index] ?? (server.hasArgs ? "" : JSON.stringify(server.args ?? []))} onChange={(e) => setMcpArguments({ ...mcpArguments, [index]: e.target.value })} />
          <Input aria-label={`MCP 环境变量 ${index + 1}`} type="password" autoComplete="new-password" placeholder={server.hasEnv ? "已保存，留空保留（JSON 对象）" : "环境变量 JSON 对象（可选）"} value={mcpEnvironment[index] ?? ""} onChange={(e) => setMcpEnvironment({ ...mcpEnvironment, [index]: e.target.value })} />
        </> : <>
        <Input aria-label={`MCP URL ${index + 1}`} placeholder="Streamable HTTP URL" value={server.url ?? ""} onChange={(e) => setSettings({ ...settings, mcpServers: settings.mcpServers.map((s, i) => i === index ? { ...s, url: e.target.value } : s) })} />
        <Input aria-label={`MCP Token ${index + 1}`} type="password" autoComplete="new-password" placeholder={server.hasHeaders ? "凭据已保存，留空保留" : "Bearer Token（可选）"} onChange={(e) => setSettings({ ...settings, mcpServers: settings.mcpServers.map((s, i) => i === index ? { ...s, headers: e.target.value ? { Authorization: `Bearer ${e.target.value}` } : undefined } : s) })} />
        </>}
        <Button variant="ghost" aria-label={`删除 MCP ${index + 1}`} onClick={() => { setSettings({ ...settings, mcpServers: settings.mcpServers.filter((_, i) => i !== index) }); const reindex = (values: Record<number, string>) => Object.fromEntries(Object.entries(values).filter(([key]) => Number(key) !== index).map(([key, value]) => [Number(key) > index ? Number(key) - 1 : Number(key), value])); setMcpArguments(reindex(mcpArguments)); setMcpEnvironment(reindex(mcpEnvironment)); }}><Trash2 className="h-4 w-4" /></Button>
      </div>)}
      <Button variant="outline" onClick={() => setSettings({ ...settings, mcpServers: [...settings.mcpServers, { serverName: "", url: "" }] })}><Plus className="mr-2 h-4 w-4" />添加 MCP 服务</Button>
    </section>
    {error && <p role="alert" className="text-destructive">{error}</p>}<Button onClick={save} disabled={saving}>{saving ? "保存中..." : "保存模型与 Agent 设置"}</Button>
  </div>;
}
