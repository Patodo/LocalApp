import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const excluded = new Set(['node_modules', '.git', 'dist', '.npm', '.pnpm', '.cache', '.next', 'coverage', '.tmp', '.localapp', '.localapp-public-skills', '.localapp-attachments']);
const excludedFile = name => name === '.env' || name.startsWith('.env.') || name === '.npmrc' || /\.(pem|key)$/.test(name);
const maxFile = 2 * 1024 * 1024, maxSource = 32 * 1024 * 1024;

export async function collectSource(directory) {
  const files = Object.create(null), inventory = [], omitted = [];
  let total = 0;
  async function walk(dir) {
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
  try { manifest = JSON.parse(files['manifest.json']); pkg = JSON.parse(files['package.json']); }
  catch { throw new Error('项目根目录必须包含文本 manifest.json 和 package.json'); }
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.name ?? '') || !pkg.scripts?.test || !pkg.scripts?.build) throw new Error('应用名称无效，或缺少 test/build 脚本');
  if (Buffer.byteLength(JSON.stringify(files)) > maxSource) throw new Error('编码后的上传内容超过 32MB');
  return { files, inventory, omitted, total, name: manifest.name };
}

function configDirectory() {
  if (process.env.LOCALAPP_CONFIG_DIR?.trim()) return process.env.LOCALAPP_CONFIG_DIR.trim();
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'localapp');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'localapp');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'localapp');
}

export async function migrate({ project, profile: profileName, owner, upload = false, cliVersion }, dependencies = {}) {
  const directory = path.resolve(project);
  const source = await collectSource(directory);
  const report = { application: source.name, fileCount: source.inventory.length, bytes: source.total, files: source.inventory, omitted: source.omitted };
  if (!upload) return { status: 'checked', ...report };
  if (!profileName || !owner || !/^[a-zA-Z0-9_-]+$/.test(owner)) throw new Error('上传必须明确指定 --profile 和 --owner');
  let document;
  try { document = JSON.parse(await fs.readFile(path.join(configDirectory(), 'profiles.json'), 'utf8')); }
  catch { throw new Error('目标 CLI profile 文件无法读取，请先登录'); }
  const profile = document.profiles?.[profileName];
  if (!profile?.apiKey || !profile.serverUrl) throw new Error('目标 profile 未登录');
  const origin = new URL(profile.serverUrl);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('目标 Server 地址无效');
  const version = (cliVersion || execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'localapp', process.platform === 'win32' ? ['/d', '/s', '/c', 'localapp --version'] : ['--version'], { encoding: 'utf8' }).trim()).replace(/^localapp\s+/, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('无法确认 localapp CLI 版本');
  const request = async (route, body) => {
    const response = await (dependencies.fetch || fetch)(origin.origin + route, {
      method: body ? 'POST' : 'GET', redirect: 'manual', signal: AbortSignal.timeout(60000),
      headers: { 'X-API-Key': profile.apiKey, 'X-CLI-Version': version, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let value;
    try { value = await response.json(); } catch { throw new Error(`Server 返回无效响应（${response.status}）`); }
    if (!response.ok || !value.success) throw new Error(`Server 请求失败（${response.status}）；请检查登录身份、已有项目或 Server 日志`);
    return value.data;
  };
  const me = await request('/api/me');
  if (me.id !== owner) throw new Error('登录用户不是指定的应用拥有者');
  const base = `/api/development/apps/${encodeURIComponent(owner)}/${encodeURIComponent(source.name)}/source`;
  const existing = await request(base);
  if (existing) return { status: 'already-hosted', projectId: existing.id, serverUrl: origin.origin, application: source.name };
  const created = await request(base, { files: source.files });
  const stored = await request(base);
  if (stored?.id !== created.id) throw new Error('上传后应用与源码项目关联不一致');
  const projectBase = `/api/development/projects/${encodeURIComponent(created.id)}`;
  const files = await request(projectBase + '/files'), versions = await request(projectBase + '/versions');
  if (files.length !== source.inventory.length || source.inventory.some(file => !files.includes(file.path)) || !versions[0]) throw new Error('上传后的文件清单或初始版本不完整，请检查服务端项目');
  const manifest = await request(projectBase + '/source-manifest');
  if (manifest.length !== source.inventory.length || source.inventory.some(file => !manifest.some(stored => stored.path === file.path && stored.bytes === file.bytes && stored.hash === file.hash))) throw new Error('上传后的源码字节不一致，请检查服务端项目');
  const receipt = { serverUrl: origin.origin, owner, application: source.name, projectId: created.id, sourceVersion: versions[0].id, fileCount: files.length, developmentUrl: `${origin.origin}/my/development?projectId=${encodeURIComponent(created.id)}` };
  const local = path.join(directory, '.localapp');
  try {
    const stat = await fs.lstat(local);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('本地 .localapp 不是普通目录');
  } catch (error) { if (error.code === 'ENOENT') await fs.mkdir(local); else throw error; }
  const receiptPath = path.join(local, 'source-migration.json');
  try { if ((await fs.lstat(receiptPath)).isSymbolicLink()) throw new Error('迁移记录不能是符号链接'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(local, `source-migration-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, receiptPath);
  } finally { await fs.rm(temporary, { force: true }); }
  return { status: 'hosted', ...receipt, validation: 'pending' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = { project: process.cwd() };
    const keys = { '--project': 'project', '--profile': 'profile', '--owner': 'owner', '--cli-version': 'cliVersion' };
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (key === '--upload') options.upload = true;
      else if (keys[key] && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) options[keys[key]] = process.argv[++i];
      else throw new Error(`参数无效：${key}`);
    }
    console.log(JSON.stringify(await migrate(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
