import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeAllConnections, insertIssue, listPotentialDuplicateIssues, updateIssue } from "../app-db.js";

describe("Issue potential duplicates", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-duplicates-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("ranks Chinese and Latin title/body overlap and includes lifecycle state", async () => {
    const exact = await insertIssue(dbPath, "截图上传出现 Unexpected token HTML", "服务未连接时返回了 <!DOCTYPE html>，客户端解析 JSON 失败。", "bug", "alice");
    const related = await insertIssue(dbPath, "图片上传失败", "上传附件时服务端 HTML 响应导致 JSON parsing error。", "bug", "bob");
    await updateIssue(dbPath, exact.id, { status: "closed", stateReason: "completed" });
    await insertIssue(dbPath, "调整导航栏颜色", "与附件和接口错误无关。", "feature", "carol");
    const body = "本地开发时上传截图，接口返回 Unexpected token '<'，响应内容以 <!DOCTYPE html> 开头，导致 JSON parsing error。".padEnd(120, "复");

    const result = await listPotentialDuplicateIssues(dbPath, "上传截图出现 Unexpected token", body);

    expect(result.map((candidate) => candidate.id)).toEqual([exact.id, related.id]);
    expect(result[0]).toMatchObject({ status: "closed", score: expect.any(Number), matched_in: expect.stringMatching(/title/) });
    expect(result[0]).not.toHaveProperty("description");
  });

  it("requires a title and 100 Unicode body characters", async () => {
    await insertIssue(dbPath, "同样的问题", "正文", "bug", "alice");
    expect(await listPotentialDuplicateIssues(dbPath, "", "x".repeat(100))).toEqual([]);
    expect(await listPotentialDuplicateIssues(dbPath, "同样的问题", "中".repeat(99))).toEqual([]);
    expect(await listPotentialDuplicateIssues(dbPath, "同样的问题", "中".repeat(100))).toHaveLength(1);
  });

  it("returns at most three candidates with deterministic score and recency ordering", async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertIssue(dbPath, `Offline image upload failure ${index}`, "Unexpected token response while uploading image", "bug", `user-${index}`);
    }
    const result = await listPotentialDuplicateIssues(dbPath, "Offline image upload failure", "Unexpected token response while uploading image".padEnd(100, " x"));
    expect(result).toHaveLength(3);
    expect(result.map(({ score }) => score)).toEqual([...result.map(({ score }) => score)].sort((left, right) => right - left));
    expect(result.every((candidate) => Object.keys(candidate).sort().join(",") === "id,issue_number,last_activity_at,matched_in,score,status,title,updated_at")).toBe(true);
  });
});
