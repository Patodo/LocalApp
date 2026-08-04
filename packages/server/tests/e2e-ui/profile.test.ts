import { test, expect, registerUser } from "./helpers.js";
import { getDb } from "../../src/lib/meta-sqlite.js";

const TEST_API_KEY = "test-ui-api-key-1234567890abcdef";

async function registerAndLogin(baseUrl: string, page: import("@playwright/test").Page, username: string, password = "test123456") {
  await registerUser(baseUrl, username, password);
  await page.request.post(`${baseUrl}/api/auth/login`, {
    data: { username, password },
  });
}

test.describe("Profile Page (/my/info)", () => {
  test("shows user info after login", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "profileui1");
    await page.goto(`${baseUrl}/my/info`);

    await expect(page.getByRole("heading", { name: "个人资料" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByPlaceholder("设置显示名称")).toBeVisible();
    await expect(page.getByPlaceholder("介绍一下自己...")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存资料" })).toBeVisible();
    await expect(page.getByRole("button", { name: "修改密码" })).toBeVisible();
  });

  test("edits display name and bio", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "profileui2");
    await page.goto(`${baseUrl}/my/info`);

    await page.getByPlaceholder("设置显示名称").fill("测试昵称");
    await page.getByPlaceholder("介绍一下自己...").fill("这是我的简介");
    await page.getByRole("button", { name: "保存资料" }).click();

    await expect(page.getByText("个人资料已保存")).toBeVisible({ timeout: 10000 });

    await page.reload();
    await expect(page.getByPlaceholder("设置显示名称")).toHaveValue("测试昵称");
    await expect(page.getByPlaceholder("介绍一下自己...")).toHaveValue("这是我的简介");
  });

  test("uploads avatar", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "profileui3");
    await page.goto(`${baseUrl}/my/info`);

    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    await expect(page.getByText("头像已更新")).toBeVisible({ timeout: 10000 });
  });

  test("changes password via modal", async ({ baseUrl, page }) => {
    await registerUser(baseUrl, "profileui4", "oldpass123");
    await page.request.post(`${baseUrl}/api/auth/login`, {
      data: { username: "profileui4", password: "oldpass123" },
    });
    await page.goto(`${baseUrl}/my/info`);

    // Open the change-password modal via the page-level trigger button.
    // After the modal opens, a second "修改密码" button (submit) appears inside it,
    // so scope interactions to the modal container.
    await page.getByRole("button", { name: "修改密码" }).click();
    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Inputs carry aria-label matching their visible <label>; exact match avoids
    // "新密码" substring-matching the "确认新密码" field.
    await modal.getByLabel("当前密码", { exact: true }).fill("oldpass123");
    await modal.getByLabel("新密码", { exact: true }).fill("newpass456");
    await modal.getByLabel("确认新密码", { exact: true }).fill("newpass456");
    await modal.getByRole("button", { name: "修改密码" }).click();

    // Modal closes on success.
    await expect(modal).not.toBeVisible({ timeout: 10000 });
  });

  test("redirects to home when not authenticated", async ({ baseUrl, page }) => {
    await page.goto(`${baseUrl}/my/info`);
    await page.waitForURL(`${baseUrl}/`);
    expect(page.url()).toBe(`${baseUrl}/`);
  });
});

test.describe("Apps Page (/my/apps)", () => {
  test("shows empty state when no apps", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "appsuser1");
    await page.goto(`${baseUrl}/my/apps`);

    await expect(page.getByRole("heading", { name: "我的应用" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("暂无应用")).toBeVisible();
  });

  test("shows app list with formal app and settings entries", async ({ baseUrl, page }) => {
    const username = "appsuser2";
    await registerAndLogin(baseUrl, page, username);

    const createKeyRes = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "X-API-Key": TEST_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username }),
    });
    const keyData = await createKeyRes.json();
    const userKey = keyData.data.key;

    await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": userKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-dashboard-app" }),
    });

    await page.goto(`${baseUrl}/my/apps`);
    await expect(page.getByRole("heading", { name: "我的应用" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("span.font-medium", { hasText: "test-dashboard-app" })).toBeVisible();

    await expect(page.getByRole("link", { name: "打开 test-dashboard-app" })).toHaveAttribute("href", `/${username}/test-dashboard-app`);
    await expect(page.getByRole("link", { name: "test-dashboard-app 设置" })).toHaveAttribute("href", "/my/apps/test-dashboard-app/settings");
    await expect(page.getByRole("button", { name: "删除" })).toHaveCount(0);
  });

  test("moves app detail and version history into settings", async ({ baseUrl, page }) => {
    const username = "appsuser3";
    await registerAndLogin(baseUrl, page, username);

    const createKeyRes = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "X-API-Key": TEST_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username }),
    });
    const keyData = await createKeyRes.json();
    const userKey = keyData.data.key;

    await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": userKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "detail-view-app" }),
    });

    await page.goto(`${baseUrl}/my/apps`);
    await expect(page.locator("span.font-medium", { hasText: "detail-view-app" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("link", { name: "detail-view-app 设置" }).click();
    await expect(page).toHaveURL(`${baseUrl}/my/apps/detail-view-app/settings`);
    await expect(page.getByRole("heading", { name: "detail-view-app 设置" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("heading", { name: "版本历史" })).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "appsuser3" })).toBeVisible();
  });
});

test.describe("API Keys Page (/my/keys)", () => {
  test("shows empty state when no keys", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "keysuser1");
    // Administrator provisioning creates one initial key; clear it for the empty state.
    getDb().run("DELETE FROM api_keys WHERE user_id = ?", ["keysuser1"]);
    await page.goto(`${baseUrl}/my/keys`);

    await expect(page.getByRole("heading", { name: "API 密钥" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("暂无 API 密钥")).toBeVisible();
  });

  test("creates new API key", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "keysuser2");
    await page.goto(`${baseUrl}/my/keys`);

    await expect(page.getByRole("heading", { name: "API 密钥" })).toBeVisible({ timeout: 10000 });

    const createResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/keys") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "创建密钥" }).first().click();
    const response = await createResponse;
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.key).toBeTruthy();

    await expect(page.getByText(body.data.key, { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test("shows existing keys as masked and non-copyable", async ({ baseUrl, page }) => {
    const username = "keysuser3";
    await registerAndLogin(baseUrl, page, username);

    const createKeyRes = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "X-API-Key": TEST_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username }),
    });
    const keyData = await createKeyRes.json();

    await page.goto(`${baseUrl}/my/keys`);
    await expect(page.locator("code.font-mono", { hasText: `••••${keyData.data.key.slice(-8)}` })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("已隐藏").first()).toBeVisible();
  });
});

test.describe("Groups Page (/my/groups)", () => {
  test("creates a private group", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "groupcreate1");
    await page.goto(`${baseUrl}/my/groups`);

    await expect(page.getByRole("heading", { name: "群组" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "创建群组" }).click();
    await expect(page.locator(".fixed.inset-0").getByText("创建群组")).toBeVisible({ timeout: 5000 });
    await page.getByPlaceholder("群组名称").fill("my-private-group");
    await page.locator(".fixed.inset-0").getByRole("button", { name: "创建" }).click();

    await expect(page.getByText("my-private-group")).toBeVisible({ timeout: 5000 });
  });

  test("views group detail and manages members", async ({ baseUrl, page }) => {
    await registerUser(baseUrl, "groupmemberuser", "test123456");
    await registerAndLogin(baseUrl, page, "groupowner1");
    await page.goto(`${baseUrl}/my/groups`);

    await expect(page.getByRole("heading", { name: "群组" })).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "创建群组" }).click();
    await page.getByPlaceholder("群组名称").fill("member-test-group");
    await page.locator(".fixed.inset-0").getByRole("button", { name: "创建" }).click();
    await expect(page.getByText("member-test-group")).toBeVisible({ timeout: 5000 });

    await page.getByText("member-test-group").click();
    await expect(page.getByRole("button", { name: "添加成员" })).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "添加成员" }).click();
    const modal = page.locator(".fixed.inset-0").last();
    await expect(modal.getByText("添加成员")).toBeVisible();
    const userLabel = modal.locator("label", { hasText: "groupmemberuser" });
    await userLabel.locator("input[type=checkbox]").check();
    await modal.getByRole("button", { name: /添加/ }).click();

    await expect(page.getByText("groupmemberuser")).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "移除" }).click();
    await page.locator(".fixed.inset-0").getByRole("button", { name: "移除" }).click();
    await expect(page.locator("text=groupmemberuser").first()).not.toBeVisible({ timeout: 5000 });
  });

  test("deletes a group with confirmation", async ({ baseUrl, page }) => {
    await registerAndLogin(baseUrl, page, "groupdel1");
    await page.goto(`${baseUrl}/my/groups`);

    await page.getByRole("button", { name: "创建群组" }).click();
    await page.getByPlaceholder("群组名称").fill("to-delete-group");
    await page.locator(".fixed.inset-0").getByRole("button", { name: "创建" }).click();
    await expect(page.getByText("to-delete-group")).toBeVisible({ timeout: 5000 });

    await page.getByText("to-delete-group").click();
    await expect(page.getByRole("button", { name: "删除" })).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "删除" }).click();
    await page.locator(".fixed.inset-0").getByRole("button", { name: "删除" }).click();

    await expect(page.getByText("to-delete-group")).not.toBeVisible({ timeout: 5000 });
  });
});
