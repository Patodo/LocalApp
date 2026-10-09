import fs from "node:fs";
import path from "node:path";

export const PUBLIC_AGENT_SKILLS = [
  { id: "markitdown", name: "MarkItDown", description: "将 PDF、Word、Excel 等文档转为 Markdown", dependencies: "Python 3.10+、markitdown；扫描件需要额外 OCR" },
  { id: "pdf", name: "PDF", description: "提取文字和表格、创建、合并、拆分及填写 PDF", dependencies: "Python 3.10+、pypdf、reportlab、pdfplumber；渲染需要 pypdfium2 或 Poppler" },
  { id: "docx", name: "Word / DOCX", description: "读取、创建和编辑 Word 文档", dependencies: "Python 3.10+、python-docx；渲染需要 LibreOffice" },
  { id: "xlsx", name: "Excel / XLSX", description: "读取、创建和编辑工作簿", dependencies: "Python 3.10+、openpyxl；公式重算需要 LibreOffice" },
] as const;

/** Materialize only selected bundles inside the isolated application workspace. */
export function preparePublicSkills(workspace: string, selected: string[]) {
  const destination = path.join(workspace, ".localapp-public-skills");
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const root = process.env.LOCALAPP_PUBLIC_SKILLS_ROOT ?? path.resolve(__dirname, "../../skills");
  for (const id of new Set(selected)) {
    if (!PUBLIC_AGENT_SKILLS.some((skill) => skill.id === id)) throw new Error("Unknown public skill");
    fs.cpSync(path.join(root, id), path.join(destination, id), { recursive: true, dereference: false });
  }
  return destination;
}
