import { test, expect, registerUser } from "./helpers.js";
import { getDb } from "../../src/lib/meta-sqlite.js";

async function setupAdmin(baseUrl: string): Promise<void> {
  await registerUser(baseUrl, "admintest", "admin123456");
  const db = getDb();
  db.run("UPDATE users SET role = 'admin' WHERE id = 'admintest'");
}

async function loginAsAdmin(baseUrl: string, page: import("@playwright/test").Page): Promise<void> {
  await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { username: "admintest", password: "admin123456" },
  });
}

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ baseUrl }) => {
    await setupAdmin(baseUrl);
  });

  test("sidebar navigation works", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/dashboard`);

    // Dashboard is the default landing page.
    await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("link", { name: "用户管理" }).click();
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

    await page.getByRole("link", { name: "应用管理" }).click();
    await expect(page.getByRole("heading", { name: "应用管理" })).toBeVisible();

    await page.getByRole("link", { name: "数据分析" }).click();
    await expect(page.getByRole("heading", { name: "数据分析" })).toBeVisible();

    await page.getByRole("link", { name: "系统配置" }).click();
    await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible();

    await page.getByRole("link", { name: "系统概览" }).click();
    await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible();
  });

  test("Dashboard shows system stats", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/dashboard`);

    // StatCard labels are exact-match (sidebar links like "用户管理"/"应用管理" contain these as substrings).
    await expect(page.getByText("用户", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("应用", { exact: true })).toBeVisible();
  });

  test("Users page shows user list and delete flow", async ({ baseUrl, page }) => {
    await registerUser(baseUrl, "todelete", "test123456");

    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/users`);

    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible({ timeout: 10000 });

    await expect(page.getByRole("cell", { name: "todelete" }).first()).toBeVisible();

    // Row delete is an inline-confirm pattern: clicking 删除 swaps in 确认/取消 buttons.
    const row = page.getByRole("row").filter({ hasText: "todelete" });
    await row.getByRole("button", { name: "删除" }).click();
    await row.getByRole("button", { name: "确认" }).click();

    await expect(page.getByRole("cell", { name: "todelete" }).first()).not.toBeVisible({ timeout: 5000 });
  });

  test("Users page creates a user and discards one-time credentials on close", async ({ baseUrl, page }) => {
    const username = `created-${Date.now()}`;
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/users`);

    await page.getByRole("button", { name: "创建用户" }).click();
    await page.getByPlaceholder("输入用户名").fill(username);
    await page.getByRole("button", { name: "创建", exact: true }).click();

    const credentials = page.getByRole("dialog", { name: "一次性凭据" });
    await expect(credentials).toBeVisible();
    await expect(credentials.getByText(username, { exact: true })).toBeVisible();
    await expect(credentials.getByText("API Key", { exact: true })).toBeVisible();
    await expect(credentials.getByText("临时密码", { exact: true })).toBeVisible();
    await credentials.getByRole("button", { name: "我已保存，关闭" }).click();
    await expect(credentials).not.toBeVisible();
    await expect(page.getByRole("cell", { name: username }).first()).toBeVisible();
  });

  test("Users page resets a user to a random one-time password", async ({ baseUrl, page }) => {
    const username = `reset-${Date.now()}`;
    await registerUser(baseUrl, username, "test-original-password");
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/users`);

    const row = page.getByRole("row").filter({ hasText: username });
    await row.getByRole("button", { name: "重置密码" }).click();
    await row.getByRole("button", { name: "确认" }).click();

    const credentials = page.getByRole("dialog", { name: "一次性凭据" });
    await expect(credentials).toBeVisible();
    await expect(credentials.getByText(username, { exact: true })).toBeVisible();
    await expect(credentials.getByText("临时密码", { exact: true })).toBeVisible();
    await expect(credentials.getByText("API Key", { exact: true })).toHaveCount(0);
    await credentials.getByRole("button", { name: "我已保存，关闭" }).click();
    await expect(credentials).not.toBeVisible();
    await expect(row.getByText("需改密")).toBeVisible();
  });

  test("Pages page shows page list and filter", async ({ baseUrl, page }) => {
    const TEST_API_KEY = "test-ui-api-key-1234567890abcdef";
    await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": TEST_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-page" }),
    });

    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/pages`);

    await expect(page.getByRole("heading", { name: "应用管理" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("test-page")).toBeVisible();

    await page.getByPlaceholder("按用户 ID 筛选...").fill("nonexistent");
    await expect(page.getByText("test-page")).not.toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "清除" }).click();
    await expect(page.getByText("test-page")).toBeVisible({ timeout: 5000 });
  });

  test("Analytics page loads with period selector", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/analytics`);

    await expect(page.getByRole("heading", { name: "数据分析" })).toBeVisible({ timeout: 10000 });

    await expect(page.getByRole("button", { name: "1 天" })).toBeVisible();
    await expect(page.getByRole("button", { name: "7 天" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30 天" })).toBeVisible();

    await page.getByRole("button", { name: "30 天" }).click();
  });

  test("Settings page shows read-only config", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/settings`);

    await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("模板仓库 URL")).toBeVisible();
    await expect(page.getByText(/只读显示/)).toBeVisible();
  });

  test("Logout shows login modal", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/dashboard`);

    await expect(page.getByRole("heading", { name: "系统概览" })).toBeVisible({ timeout: 10000 });

    // The sidebar's logout button is icon-only (no accessible name) — locate it via its icon.
    await page.locator("button:has(svg.lucide-log-out)").click();

    // A login modal appears (no navigation).
    await expect(page.locator(".fixed.inset-0")).toBeVisible({ timeout: 5000 });
  });

  test("non-admin user is redirected from admin pages", async ({ baseUrl, page }) => {
    await registerUser(baseUrl, "normaluser", "test123456");
    await page.request.post(`${baseUrl}/api/auth/login`, {
      data: { username: "normaluser", password: "test123456" },
    });

    await page.goto(`${baseUrl}/my/dashboard`);
    await page.waitForURL(`${baseUrl}/`);
    expect(page.url()).toBe(`${baseUrl}/`);
  });
});

test.describe("Admin Panel - Groups", () => {
  test.beforeEach(async ({ baseUrl }) => {
    await setupAdmin(baseUrl);
  });

  test("navigates to groups page via sidebar", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/dashboard`);

    await page.getByRole("link", { name: "组织管理" }).click();
    await expect(page.getByRole("heading", { name: "群组管理" })).toBeVisible({ timeout: 10000 });
  });

  test("creates a system group", async ({ baseUrl, page }) => {
    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/orgs`);

    await expect(page.getByRole("heading", { name: "群组管理" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "新建群组" }).click();
    const modal = page.locator(".fixed.inset-0");
    await expect(modal.getByText("新建系统群组")).toBeVisible();

    await modal.getByPlaceholder("群组名称").fill("admin-test-group");
    await modal.getByPlaceholder("可选").fill("E2E test group");
    await modal.getByRole("button", { name: "创建" }).click();

    await expect(page.getByText("admin-test-group")).toBeVisible({ timeout: 5000 });
  });

  test("views group detail and adds member", async ({ baseUrl, page }) => {
    await registerUser(baseUrl, "groupmember1", "test123456");

    await loginAsAdmin(baseUrl, page);
    await page.goto(`${baseUrl}/my/orgs`);

    await expect(page.getByRole("heading", { name: "群组管理" })).toBeVisible({ timeout: 10000 });

    // "everyone" is the system group auto-created on bootstrap.
    await page.getByText("everyone").click();

    // Detail card appears on the right.
    await expect(page.getByText("群组详情")).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "添加成员" }).click();
    const picker = page.getByText("选择要添加的用户").locator("..");
    await expect(page.getByText("选择要添加的用户")).toBeVisible();

    await page.getByPlaceholder("搜索用户...").fill("groupmember1");
    await expect(page.getByText("groupmember1", { exact: true })).toBeVisible({ timeout: 5000 });

    // Picker shows matching users each with an "添加" button.
    await page.getByRole("button", { name: "添加" }).click();

    await expect(page.getByText("groupmember1").first()).toBeVisible({ timeout: 5000 });
  });
});
