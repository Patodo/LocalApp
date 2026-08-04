import { getDb } from "./meta-sqlite.js";

export type SubscriptionLevel = "all" | "important" | "muted";

const ALLOWED_LEVELS = new Set<SubscriptionLevel>(["all", "important", "muted"]);

export interface SubscriptionRecord {
  user_id: string;
  app_owner: string;
  app_name: string;
  level: SubscriptionLevel;
  created_at: string;
}

function assertLevel(level: string): asserts level is SubscriptionLevel {
  if (!ALLOWED_LEVELS.has(level as SubscriptionLevel)) {
    throw new Error(`Invalid subscription level: ${level}. Allowed: all, important, muted`);
  }
}

/**
 * 创建或更新订阅。level 必须是 all/important/muted。
 * 同一 (user_id, app_owner, app_name) 仅保留一份，重复 upsert 等于改 level。
 */
export function upsertSubscription(
  userId: string,
  appOwner: string,
  appName: string,
  level: SubscriptionLevel,
): void {
  assertLevel(level);
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO subscriptions (user_id, app_owner, app_name, level, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, app_owner, app_name) DO UPDATE SET level = excluded.level`,
    [userId, appOwner, appName, level, now],
  );
}

/**
 * 退订。不存在时静默返回。
 */
export function deleteSubscription(userId: string, appOwner: string, appName: string): void {
  const db = getDb();
  db.run(
    `DELETE FROM subscriptions WHERE user_id = ? AND app_owner = ? AND app_name = ?`,
    [userId, appOwner, appName],
  );
}

/**
 * 列出某 user 的全部订阅。
 */
export function listSubscriptionsByUser(userId: string): SubscriptionRecord[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT user_id, app_owner, app_name, level, created_at
     FROM subscriptions WHERE user_id = ?
     ORDER BY app_owner, app_name`,
  );
  stmt.bind([userId]);
  const rows: SubscriptionRecord[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as SubscriptionRecord);
  }
  stmt.free();
  return rows;
}

/**
 * 查询某 user 对某 app 的订阅状态。未订阅返回 null。
 */
export function getSubscriptionStatus(
  userId: string,
  appOwner: string,
  appName: string,
): { level: SubscriptionLevel } | null {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT level FROM subscriptions WHERE user_id = ? AND app_owner = ? AND app_name = ?`,
  );
  stmt.bind([userId, appOwner, appName]);
  let level: SubscriptionLevel | null = null;
  if (stmt.step()) {
    const row = stmt.getAsObject() as { level: SubscriptionLevel };
    level = row.level;
  }
  stmt.free();
  return level === null ? null : { level };
}
