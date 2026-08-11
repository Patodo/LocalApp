import { useEffect, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Download, FileText, Image as ImageIcon, Loader2, Trash2, UploadCloud, UserRound } from "lucide-react";
import { useMe, useMutation, useQuery, useUpload } from "@localapp/sdk-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface ResumeRecord {
  id: number;
  candidate_name: string;
  file_key: string;
  file_url: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

interface ResumeListResult {
  rows: ResumeRecord[];
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(record: ResumeRecord): boolean {
  return record.mime_type.startsWith("image/");
}

function isPdf(record: ResumeRecord): boolean {
  return record.mime_type === "application/pdf";
}

export default function App() {
  const { me, loading: loadingMe } = useMe();
  const listQuery = useQuery<ResumeListResult>();
  const { mutate, loading: mutating, error: mutationError } = useMutation();
  const { upload, loading: uploading, error: uploadError } = useUpload();
  const [resumes, setResumes] = useState<ResumeRecord[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const selected = useMemo(() => resumes.find((resume) => resume.id === selectedId) ?? resumes[0] ?? null, [resumes, selectedId]);

  async function refresh() {
    const result = await listQuery.query("$resumes.list", { limit: 50, offset: 0 });
    setResumes(result.rows);
    setSelectedId((current) => current ?? result.rows[0]?.id ?? null);
  }

  useEffect(() => { void refresh(); }, []);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    const form = event.currentTarget;
    const input = form.elements.namedItem("resume-file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !candidateName.trim()) {
      setLocalError("请填写候选人姓名并选择 PNG、JPEG 或 PDF 文件");
      return;
    }
    if (!(["image/png", "image/jpeg", "application/pdf"] as string[]).includes(file.type)) {
      setLocalError("只支持 PNG、JPEG 和 PDF");
      return;
    }
    try {
      const uploaded = await upload(file);
      const created = await mutate("$resumes.create", {
        candidate_name: candidateName.trim(),
        file_key: uploaded.key,
        file_url: uploaded.url,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      const createdId = typeof (created as { lastInsertRowId?: number }).lastInsertRowId === "number"
        ? (created as { lastInsertRowId: number }).lastInsertRowId
        : null;
      setCandidateName("");
      form.reset();
      await refresh();
      if (createdId !== null) setSelectedId(createdId);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function removeSelected() {
    if (!selected) return;
    setLocalError(null);
    try {
      await mutate("$resumes.delete", { id: selected.id });
      setSelectedId(null);
      await refresh();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const error = localError ?? listQuery.error?.message ?? mutationError?.message ?? uploadError?.message ?? null;
  const busy = listQuery.loading || uploading || mutating;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm text-indigo-600"><FileText className="h-4 w-4" /> LocalApp 应用示例</div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">简历管理</h1>
            <p className="mt-2 max-w-2xl text-slate-600">上传候选人简历，在线预览原始文件，并保留可下载的文件记录。</p>
          </div>
          <Badge variant="secondary" className="w-fit">{loadingMe ? "正在识别用户" : me ? `你好，${me.name}` : "未登录访客"}</Badge>
        </header>

        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5 text-indigo-600" />上传简历</CardTitle>
              <CardDescription>文件通过 Server 内容存储上传，数据库只保存受保护的元数据。</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={(event) => void handleUpload(event)}>
                <div className="space-y-2">
                  <Label htmlFor="candidate-name">候选人姓名</Label>
                  <Input id="candidate-name" value={candidateName} onChange={(event) => setCandidateName(event.target.value)} placeholder="例如：林晓" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resume-file">简历文件</Label>
                  <Input id="resume-file" name="resume-file" type="file" accept="image/png,image/jpeg,application/pdf" required />
                  <p className="text-xs text-slate-500">支持 PNG、JPEG、PDF，单文件最大 10 MB。</p>
                </div>
                <Button type="submit" className="w-full" disabled={busy}>{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />处理中...</> : "上传并保存"}</Button>
              </form>
              {error ? <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><CardTitle>我的候选人</CardTitle><CardDescription>仅显示当前用户创建的简历记录。</CardDescription></div>
              <Button variant="outline" onClick={() => void refresh()} disabled={busy}>刷新</Button>
            </CardHeader>
            <CardContent className="grid gap-5 xl:grid-cols-[280px_1fr]">
              <div className="space-y-2">
                {resumes.length === 0 && !listQuery.loading ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">还没有上传简历。</p> : null}
                {resumes.map((resume) => (
                  <button key={resume.id} type="button" onClick={() => { setSelectedId(resume.id); setPdfPage(1); }} className={`w-full rounded-lg border p-3 text-left transition ${selected?.id === resume.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`}>
                    <div className="flex items-start gap-3"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" /><span className="min-w-0"><strong className="block truncate">{resume.candidate_name}</strong><span className="mt-1 block truncate text-xs text-slate-500">{resume.file_name}</span><span className="mt-1 block text-xs text-slate-400">{formatBytes(resume.size_bytes)}</span></span></div>
                  </button>
                ))}
              </div>

              <div className="min-h-[360px] rounded-xl border border-slate-200 bg-slate-50 p-4">
                {!selected ? <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-slate-500">选择一份简历开始预览。</div> : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h2 className="font-semibold">{selected.candidate_name}</h2><p className="text-sm text-slate-500">{selected.file_name} · {selected.mime_type}</p></div>
                      <div className="flex gap-2"><a href={selected.file_url} download={selected.file_name} className="inline-flex h-9 items-center rounded-md border border-slate-300 px-3 text-sm hover:bg-white"><Download className="mr-2 h-4 w-4" />下载原文件</a><Button variant="outline" size="sm" onClick={() => void removeSelected()} disabled={mutating}><Trash2 className="mr-2 h-4 w-4" />删除</Button></div>
                    </div>
                    {isImage(selected) ? <button type="button" onClick={() => setLightboxOpen(true)} className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white"><img src={selected.file_url} alt={`${selected.candidate_name} 的 ${selected.file_name}`} className="mx-auto max-h-[480px] object-contain transition group-hover:scale-[1.01]" /></button> : null}
                    {isPdf(selected) ? <div className="overflow-auto rounded-lg border border-slate-200 bg-white p-3"><Document file={selected.file_url} onLoadSuccess={({ numPages }) => { setPdfPages(numPages); setPdfPage((page) => Math.min(page, numPages)); }} loading={<p className="p-8 text-center text-sm text-slate-500">PDF 加载中...</p>} error={<p className="p-8 text-center text-sm text-rose-600">PDF 预览失败，请下载原文件。</p>}><Page pageNumber={pdfPage} width={Math.min(720, typeof window === "undefined" ? 720 : window.innerWidth - 80)} /></Document><div className="mt-3 flex items-center justify-center gap-3 text-sm"><Button variant="outline" size="sm" onClick={() => setPdfPage((page) => Math.max(1, page - 1))} disabled={pdfPage <= 1}>上一页</Button><span>第 {pdfPage} / {pdfPages || "…"} 页</span><Button variant="outline" size="sm" onClick={() => setPdfPage((page) => Math.min(pdfPages || page, page + 1))} disabled={pdfPages === 0 || pdfPage >= pdfPages}>下一页</Button></div></div> : null}
                    {!isImage(selected) && !isPdf(selected) ? <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500"><ImageIcon className="mr-2 h-4 w-4" />此文件类型没有内联预览，请下载原文件。</div> : null}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
      <Lightbox open={lightboxOpen} close={() => setLightboxOpen(false)} slides={selected && isImage(selected) ? [{ src: selected.file_url, alt: `${selected.candidate_name} 的 ${selected.file_name}` }] : []} />
    </main>
  );
}
