import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
export type SourceFile = string | {encoding: "base64"; content: string};
const excluded = new Set(['node_modules', '.git', 'dist', '.npm', '.pnpm', '.cache', '.next', 'coverage', '.tmp', 'tmp', '.localapp', '.localapp-public-skills', '.localapp-attachments']);
const excludedFile = (name: string) => name === '.env' || name.startsWith('.env.') || name === '.npmrc' || /\.(pem|key)$/.test(name);
const maxFile = 2 * 1024 * 1024, maxSource = 32 * 1024 * 1024;

export async function collectSource(directory: string) {
  const files: Record<string, SourceFile> = Object.create(null), inventory: {path: string; bytes: number; binary: boolean; hash: string}[] = [], omitted: string[] = [];
  let total = 0;
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name), relative = path.relative(directory, absolute).split(path.sep).join('/');
      if (excluded.has(entry.name) || excludedFile(entry.name)) { omitted.push(relative); continue; }
      if (entry.isSymbolicLink()) throw new Error(`源码包含符号链接：${relative}`);
      if (relative.includes('\\')) throw new Error(`文件名不支持反斜线：${relative}`);
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile()) throw new Error(`不是普通文件：${relative}`);
      const stat = await fs.stat(absolute);
      if (stat.size > maxFile) throw new Error(`文件超过 2MB：${relative}`);
      const bytes = await fs.readFile(absolute);
      total += bytes.length;
      if (bytes.length > maxFile || total > maxSource || inventory.length >= 5000) throw new Error('源码超过 32MB、5000 文件或单文件 2MB 的限制');
      const text = bytes.toString('utf8');
      const binary = text.includes('\0') || !Buffer.from(text).equals(bytes);
      files[relative] = binary ? { encoding: 'base64', content: bytes.toString('base64') } : text;
      inventory.push({ path: relative, bytes: bytes.length, binary, hash: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await walk(directory);
  let manifest, pkg;
  try { manifest = JSON.parse(files['manifest.json'] as string); pkg = JSON.parse(files['package.json'] as string); }
  catch { throw new Error('项目根目录必须包含文本 manifest.json 和 package.json'); }
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.name ?? '') || !pkg.scripts?.test || !pkg.scripts?.build) throw new Error('应用名称无效，或缺少 test/build 脚本');
  if (Buffer.byteLength(JSON.stringify(files)) > maxSource) throw new Error('编码后的上传内容超过 32MB');
  return { files, inventory, omitted, total, name: manifest.name };
}

