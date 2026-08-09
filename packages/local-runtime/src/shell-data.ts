//! PlatformShell 本地数据层。
//!
//! 为本地应用提供 PlatformShell 依赖的 API 数据(favorites/issues/me/meta),
//! 数据存独立 shell.db(不污染 app.db),单用户场景。
//! 远程 server 的对应实现在 packages/server/src/routes/{favorites,issues,profile}.ts。

import fs from "node:fs";
import path from "node:path";
import { withDbQueue } from "@localapp/server-core";
import type { FastifyRequest, FastifyReply } from "fastify";

const LOCAL_USER_ID = "local-user";
const LOCAL_USER = {
  id: LOCAL_USER_ID,
  name: "Local User",
  displayName: "Local User",
  role: "owner" as const,
};

const SHELL_DB_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS local_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_path TEXT NOT NULL UNIQUE,
    page_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS local_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_path TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    labels TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

export interface ShellDataOptions {
  /** shell.db 存放目录(应用 dataRoot) */
  dataRoot: string;
  /** 当前应用 appId(作为 PlatformShell 的 name) */
  appId: string;
}

export class ShellData {
  private readonly dbPath: string;
  private readonly appId: string;
  private initialized = false;

  constructor(options: ShellDataOptions) {
    this.dbPath = path.join(options.dataRoot, "shell.db");
    this.appId = options.appId;
  }

  /** 懒初始化:首次访问时建表。 */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      for (const sql of SHELL_DB_SCHEMA) {
        db.run(sql);
      }
      this.persist(db);
    });
    this.initialized = true;
  }

  /** 保存 db 到文件(sql.js 是内存库,需手动 export)。 */
  private persist(db: { export: () => Uint8Array | ArrayBuffer }): void {
    const exported = db.export();
    const data = Buffer.from(
      Array.from(exported instanceof ArrayBuffer ? new Uint8Array(exported) : exported),
    );
    fs.writeFileSync(this.dbPath, data);
  }

  /** 当前应用的 pagePath(local-user/<appId>)。 */
  private get pagePath(): string {
    return `${LOCAL_USER_ID}/${this.appId}`;
  }

  // ── API handlers ──

  /** GET /api/me */
  handleMe(_req: FastifyRequest, reply: FastifyReply): void {
    reply.send({ success: true, data: LOCAL_USER });
  }

  /** GET /api/users */
  handleUsers(_req: FastifyRequest, reply: FastifyReply): void {
    reply.send({ success: true, data: [LOCAL_USER] });
  }

  /** GET /api/pages/:userId/:name/meta(硬阻塞,必须 lifecycleStatus=online) */
  handleMeta(_req: FastifyRequest, reply: FastifyReply): void {
    reply.send({
      success: true,
      data: {
        name: this.appId,
        userId: LOCAL_USER_ID,
        description: "",
        shell: { navbar: true },
        notify: { enabled: false },
        lifecycleStatus: "online",
      },
    });
  }

  /** GET /api/favorites/count?pagePath= */
  async handleFavoritesCount(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      const stmt = db.prepare("SELECT COUNT(*) AS count FROM local_favorites");
      const row = stmt.getAsObject();
      stmt.free();
      reply.send({ success: true, data: { count: Number(row.count ?? 0) } });
    });
  }

  /** GET /api/favorites/check?pagePath= */
  async handleFavoritesCheck(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const pagePath = (req.query as { pagePath?: string }).pagePath ?? this.pagePath;
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      const stmt = db.prepare("SELECT 1 FROM local_favorites WHERE page_path = ? LIMIT 1");
      stmt.bind([pagePath]);
      const favorited = stmt.step();
      stmt.free();
      reply.send({ success: true, data: { favorited } });
    });
  }

  /** POST /api/favorites {pagePath, pageName?} */
  async handleFavoritesCreate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const body = req.body as { pagePath?: string; pageName?: string } | null;
    const pagePath = body?.pagePath ?? this.pagePath;
    const pageName = body?.pageName ?? this.appId;
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      db.run(
        "INSERT OR IGNORE INTO local_favorites (page_path, page_name) VALUES (?, ?)",
        [pagePath, pageName],
      );
      this.persist(db);
      reply.send({ success: true, data: { favorited: true } });
    });
  }

  /** DELETE /api/favorites/:pagePath */
  async handleFavoritesDelete(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const params = req.params as { pagePath?: string };
    const pagePath = decodeURIComponent(params.pagePath ?? this.pagePath);
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      db.run("DELETE FROM local_favorites WHERE page_path = ?", [pagePath]);
      this.persist(db);
      reply.send({ success: true, data: { favorited: false } });
    });
  }

  /** GET /api/issues?pagePath=&status=&limit=&offset= */
  async handleIssuesList(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const query = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
      pagePath?: string;
    };
    const status = query.status ?? "all";
    const limit = Math.min(Number(query.limit ?? 25), 100);
    const offset = Number(query.offset ?? 0);
    const pagePath = query.pagePath ?? this.pagePath;
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      let where = "WHERE page_path = ?";
      const params: (string | number)[] = [pagePath];
      if (status === "open" || status === "closed") {
        where += " AND status = ?";
        params.push(status);
      }
      const listStmt = db.prepare(
        `SELECT * FROM local_issues ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      );
      listStmt.bind([...params, limit, offset]);
      const rows: unknown[] = [];
      while (listStmt.step()) {
        rows.push(listStmt.getAsObject());
      }
      listStmt.free();

      const countStmt = db.prepare(
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS closed
          FROM local_issues WHERE page_path = ?`,
      );
      countStmt.bind([pagePath]);
      const stats = countStmt.getAsObject();
      countStmt.free();

      reply.send({
        success: true,
        data: rows,
        pinned: [],
        meta: {
          total: Number(stats.total ?? 0),
          open: Number(stats.open ?? 0),
          closed: Number(stats.closed ?? 0),
          limit,
          offset,
        },
      });
    });
  }

  /** POST /api/issues {title, body?, pagePath?} */
  async handleIssueCreate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const body = req.body as { title?: string; body?: string; pagePath?: string } | null;
    const title = body?.title?.trim();
    if (!title) {
      reply.status(400).send({ success: false, error: "title is required" });
      return;
    }
    const pagePath = body?.pagePath ?? this.pagePath;
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      db.run(
        "INSERT INTO local_issues (page_path, title, body, status) VALUES (?, ?, ?, 'open')",
        [pagePath, title, body?.body ?? null],
      );
      this.persist(db);
      const stmt = db.prepare("SELECT * FROM local_issues WHERE id = last_insert_rowid()");
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      reply.send({ success: true, data: row });
    });
  }

  /** PATCH /api/issues/:id(更新状态/body) */
  async handleIssueUpdate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.ensureInitialized();
    const id = Number((req.params as { id?: string }).id);
    const body = req.body as { status?: string; title?: string; body?: string } | null;
    if (!Number.isFinite(id)) {
      reply.status(400).send({ success: false, error: "invalid id" });
      return;
    }
    await withDbQueue(this.dbPath, async () => {
      const { getConnection } = await import("@localapp/server-core");
      const db = await getConnection(this.dbPath);
      const sets: string[] = ["updated_at = datetime('now')"];
      const params: (string | number)[] = [];
      if (body?.status) { sets.push("status = ?"); params.push(body.status); }
      if (body?.title != null) { sets.push("title = ?"); params.push(body.title); }
      if (body?.body != null) { sets.push("body = ?"); params.push(body.body); }
      params.push(id);
      db.run(`UPDATE local_issues SET ${sets.join(", ")} WHERE id = ?`, params);
      this.persist(db);
      const stmt = db.prepare("SELECT * FROM local_issues WHERE id = ?");
      stmt.bind([id]);
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();
      reply.send({ success: true, data: row });
    });
  }

  /** Issues 子端点(config/labels/views/milestones)—— 本地降级返回空。 */
  handleIssuesSubEmpty(_req: FastifyRequest, reply: FastifyReply): void {
    reply.send({ success: true, data: [] });
  }

  handleIssuesConfig(_req: FastifyRequest, reply: FastifyReply): void {
    reply.send({ success: true, data: { templates: [], labels: [], milestones: [] } });
  }
}
