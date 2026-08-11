import { useState } from "react";
import { ShieldCheck, Sparkles, Terminal, FolderOpen, CheckCircle2, AlertCircle } from "lucide-react";
import { useDeviceAction, useMe } from "@localapp/sdk-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createSkillInstallRequest,
  DEFAULT_INSTALL_ROOT,
  FIXTURE_SKILL_BODY,
  FIXTURE_SKILL_NAME,
  type SkillInstallResult,
} from "./device-action";

const catalog = [
  {
    name: FIXTURE_SKILL_NAME,
    title: "Device Actions Helper",
    description: "在当前点击按钮的电脑上执行最小权限本机操作。",
    version: "1.0.0",
    publisher: "LocalApp Labs",
    tags: ["device", "safety", "automation"],
  },
  {
    name: "resume-reviewer",
    title: "Resume Reviewer",
    description: "帮助整理候选人资料并生成结构化审阅清单。",
    version: "0.4.0",
    publisher: "Community",
    tags: ["resume", "workflow"],
  },
  {
    name: "meeting-notes",
    title: "Meeting Notes",
    description: "把会议纪要拆成行动项，保持输入和结果可追踪。",
    version: "0.2.1",
    publisher: "Community",
    tags: ["notes", "productivity"],
  },
] as const;

function statusLabel(status: string | null): string {
  switch (status) {
    case "pending": return "等待本机激活";
    case "claimed": return "本机已接收";
    case "awaiting_trust": return "等待本机管理员确认";
    case "preparing": return "准备执行";
    case "running": return "正在安装";
    case "succeeded": return "安装完成";
    case "failed": return "安装失败";
    default: return status ?? "尚未安装";
  }
}

export default function App() {
  const { me, loading: loadingMe } = useMe();
  const { run, requestId, status, result, error, loading } = useDeviceAction<SkillInstallResult>();
  const [selected, setSelected] = useState<(typeof catalog)[number]>(catalog[0]);
  const [targetRoot, setTargetRoot] = useState(DEFAULT_INSTALL_ROOT);
  const [localError, setLocalError] = useState<string | null>(null);

  async function installSelected() {
    setLocalError(null);
    try {
      await run(createSkillInstallRequest(targetRoot, selected.name, selected === catalog[0] ? FIXTURE_SKILL_BODY : `# ${selected.title}\n\n${selected.description}\n`));
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const failure = localError ?? error?.message ?? null;
  const completed = status === "succeeded" && result;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
        <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-cyan-300"><Sparkles className="h-4 w-4" /> LocalApp 应用示例</div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">SKILL 市场</h1>
            <p className="mt-2 max-w-2xl text-slate-400">浏览可复用技能，并将安装动作交给当前点击按钮的这台电脑执行。</p>
          </div>
          <Badge variant="secondary" className="w-fit bg-slate-800 text-slate-200">
            {loadingMe ? "正在识别用户" : me ? `你好，${me.name}` : "未登录访客"}
          </Badge>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {catalog.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={`text-left ${selected.name === skill.name ? "ring-2 ring-cyan-400" : ""}`}
                onClick={() => setSelected(skill)}
              >
                <Card className="h-full border-slate-800 bg-slate-900/70 text-slate-100 transition hover:border-cyan-500/70">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300"><Terminal className="h-5 w-5" /></div>
                      <Badge variant="outline" className="border-slate-700 text-slate-400">v{skill.version}</Badge>
                    </div>
                    <CardTitle className="pt-2">{skill.title}</CardTitle>
                    <CardDescription className="text-slate-400">{skill.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {skill.tags.map((tag) => <Badge key={tag} variant="secondary" className="bg-slate-800 text-slate-300">{tag}</Badge>)}
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>

          <Card className="border-cyan-900/70 bg-slate-900 text-slate-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-cyan-300" />安装到当前电脑</CardTitle>
              <CardDescription className="text-slate-400">安装前展示完整操作和权限，执行由本机 Server 完成。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="skill-target" className="text-slate-300">安装根目录（绝对路径）</Label>
                <div className="flex gap-2">
                  <FolderOpen className="mt-2 h-4 w-4 shrink-0 text-slate-500" />
                  <Input id="skill-target" value={targetRoot} onChange={(event) => setTargetRoot(event.target.value)} className="border-slate-700 bg-slate-950 text-slate-100" />
                </div>
                <p className="text-xs text-slate-500">将写入 `{targetRoot}/{selected.name}/SKILL.md`</p>
              </div>

              <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4 text-sm">
                <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /><span>filesystemWrite：仅允许写入上面的安装根目录</span></div>
                <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /><span>childProcess：关闭，不执行外部命令</span></div>
                <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /><span>脚本：校验名称、路径和大小，使用临时文件后原子替换</span></div>
              </div>

              <Button className="w-full bg-cyan-500 text-slate-950 hover:bg-cyan-400" onClick={() => void installSelected()} disabled={loading || !targetRoot.trim()}>
                {loading ? "等待本机执行..." : `安装 ${selected.title}`}
              </Button>

              {requestId ? <p className="break-all text-xs text-slate-500">请求 {requestId} · {statusLabel(status)}</p> : null}
              {completed ? (
                <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
                  <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" />{statusLabel(status)}</p>
                  <p className="mt-2 break-all">{result.installedPath}</p>
                  <p className="mt-1 text-xs text-emerald-300/70">{result.bytes} bytes · SHA-256 {result.digest}</p>
                </div>
              ) : null}
              {failure ? <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{failure}</p> : null}
              {status === "awaiting_trust" ? <p className="text-sm text-amber-200">请在本机 Server 的 Device Actions 页面确认这次首次来源授权。</p> : null}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
