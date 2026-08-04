import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type {
  LocalApp,
  LocalRuntimeSnapshot,
  ServerProfileSummary,
} from "../lib/types";
import { AppsView } from "./apps-view";

afterEach(cleanup);

const runtime: LocalRuntimeSnapshot = {
  status: "running",
  restartCount: 0,
  ready: { host: "127.0.0.1", port: 43127, pid: 1234 },
};

const app: LocalApp = {
  appId: "notes-app",
  currentVersion: "1.0.0",
  installedVersions: ["1.0.0"],
  versionRoot: "/desktop/apps/notes-app/versions/1.0.0",
  dataRoot: "/desktop/app-data/notes-app",
  status: "ready",
};

const profiles: ServerProfileSummary[] = [
  {
    name: "production",
    serverUrl: "https://work.example",
    active: true,
    loggedIn: true,
  },
  {
    name: "staging",
    serverUrl: "https://staging.example",
    active: false,
    loggedIn: true,
  },
];

it("lets an offline personal user install and open local applications", async () => {
  const user = userEvent.setup();
  const onInstall = vi.fn();
  const onOpen = vi.fn();
  render(
    <AppsView
      apps={[app]}
      profiles={profiles}
      runtime={runtime}
      onDelete={vi.fn()}
      onInstall={onInstall}
      onOpen={onOpen}
      onPublish={vi.fn()}
      onUninstall={vi.fn()}
    />,
  );

  expect(screen.getByRole("heading", { name: "本地应用" })).toBeVisible();
  expect(screen.getByText("notes-app")).toBeVisible();
  expect(screen.getByText("1.0.0")).toBeVisible();
  expect(screen.getByText("运行中")).toBeVisible();
  expect(screen.queryByText(/登录/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "安装应用包" }));
  expect(onInstall).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "打开 notes-app" }));
  expect(onOpen).toHaveBeenCalledWith("notes-app");
});

it("distinguishes uninstall with retained data from permanent deletion", async () => {
  const user = userEvent.setup();
  const onUninstall = vi.fn();
  const onDelete = vi.fn();
  render(
    <AppsView
      apps={[app]}
      profiles={profiles}
      runtime={runtime}
      onDelete={onDelete}
      onInstall={vi.fn()}
      onOpen={vi.fn()}
      onPublish={vi.fn()}
      onUninstall={onUninstall}
    />,
  );

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "卸载并保留数据" }));
  expect(onUninstall).toHaveBeenCalledWith("notes-app");

  await user.click(screen.getByRole("button", { name: "更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "永久删除" }));
  expect(screen.getByRole("dialog", { name: "永久删除 notes-app" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认永久删除" }));
  expect(onDelete).toHaveBeenCalledWith("notes-app");
});

it("publishes to an explicitly selected profile without offering local data", async () => {
  const user = userEvent.setup();
  const onPublish = vi.fn().mockResolvedValue({
    name: "notes-app",
    url: "https://staging.example/example-user/notes-app/",
    rawUrl: "https://staging.example/serve/example-user/notes-app/",
    version: 3,
    serverUrl: "https://staging.example",
    profile: "staging",
  });
  render(
    <AppsView
      apps={[app]}
      profiles={profiles}
      runtime={runtime}
      onDelete={vi.fn()}
      onInstall={vi.fn()}
      onOpen={vi.fn()}
      onPublish={onPublish}
      onUninstall={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "发布 notes-app" }));
  expect(screen.getByText("本地数据库、文件和备份不会随应用发布。")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("目标 Server"), "staging");
  await user.click(screen.getByRole("button", { name: "确认发布" }));

  expect(onPublish).toHaveBeenCalledWith("notes-app", "staging");
  expect(await screen.findByText("https://staging.example/example-user/notes-app/")).toBeVisible();
});

it("shows each app health independently and prevents opening an app with an actionable error", () => {
  render(
    <AppsView
      apps={[
        app,
        {
          ...app,
          appId: "broken-app",
          status: "error",
          error: "Backend contract is invalid: resources/items/schema.json",
        },
        {
          ...app,
          appId: "idle-app",
          status: "unavailable",
        },
      ]}
      profiles={profiles}
      runtime={runtime}
      onDelete={vi.fn()}
      onInstall={vi.fn()}
      onOpen={vi.fn()}
      onPublish={vi.fn()}
      onUninstall={vi.fn()}
    />,
  );

  expect(screen.getByText("可用")).toBeVisible();
  expect(screen.getByText("尚未就绪")).toBeVisible();
  expect(screen.getByText("Backend contract is invalid: resources/items/schema.json")).toBeVisible();
  expect(screen.getByRole("button", { name: "打开 broken-app" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "打开 notes-app" })).toBeEnabled();
});

it("shows an actionable app error when opening fails before runtime health is available", async () => {
  const user = userEvent.setup();
  render(
    <AppsView
      apps={[{ ...app, status: "unavailable" }]}
      profiles={profiles}
      runtime={runtime}
      onDelete={vi.fn()}
      onInstall={vi.fn()}
      onOpen={vi.fn().mockRejectedValue(
        new Error("notes-app.localhost resolved to a non-loopback address"),
      )}
      onPublish={vi.fn()}
      onUninstall={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "打开 notes-app" }));

  expect(
    await screen.findByText("notes-app.localhost resolved to a non-loopback address"),
  ).toBeVisible();
});
