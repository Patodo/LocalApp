import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// Mock useMe before importing the hook under test so useMemo binds to mock data
const useMeMock = vi.fn();
vi.mock("../src/hooks/use-me.js", () => ({
  useMe: (...args: unknown[]) => useMeMock(...args),
}));

import { usePermissions } from "../src/hooks/use-permissions.js";
import { Can } from "../src/components/can.js";
import type { DataSchemaLike } from "../src/permissions.js";

function makeMe(id: string | null, name: string | null) {
  return id === null ? null : { id, name, role: "user" as const };
}

function setMe(id: string | null, name: string | null = id ? `user-${id}` : null) {
  useMeMock.mockReturnValue({
    me: makeMe(id, name),
    loading: false,
    error: null,
  });
}

beforeEach(() => {
  useMeMock.mockReset();
  setMe(null);
});

const ownerSchema: DataSchemaLike = {
  business: {
    recordAccess: {
      update: { mode: "ownerField", field: "ownerId" },
      read: { mode: "authenticated" },
    },
  },
};

describe("usePermissions - 无登录用户", () => {
  it("can 对所有者策略一律返回 false", () => {
    setMe(null);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("update", { ownerId: "u-1" }, ownerSchema)).toBe(false);
  });

  it("can 对 authenticated 策略返回 false", () => {
    setMe(null);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("read", {}, ownerSchema)).toBe(false);
  });

  it("loading 和 error 透传 useMe 的状态", () => {
    useMeMock.mockReturnValue({ me: null, loading: true, error: null });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });
});

describe("usePermissions - 已登录用户", () => {
  it("ownerField 匹配当前用户时允许", () => {
    setMe("u-1", "alice");
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("update", { ownerId: "u-1" }, ownerSchema)).toBe(true);
  });

  it("ownerField 不匹配当前用户时拒绝", () => {
    setMe("u-1", "alice");
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("update", { ownerId: "u-2" }, ownerSchema)).toBe(false);
  });

  it("authenticated 策略对登录用户允许", () => {
    setMe("u-1");
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can("read", {}, ownerSchema)).toBe(true);
  });

  it("can 函数在 me 不变时保持引用稳定", () => {
    setMe("u-1", "alice");
    const { result, rerender } = renderHook(() => usePermissions());
    const first = result.current.can;
    rerender();
    expect(result.current.can).toBe(first);
  });
});

describe("<Can> 组件", () => {
  it("有权限时渲染 children", () => {
    setMe("u-1", "alice");
    render(
      <Can action="update" record={{ ownerId: "u-1" }} schema={ownerSchema}>
        <button>编辑</button>
      </Can>,
    );
    expect(screen.getByText("编辑")).toBeTruthy();
  });

  it("无权限时不渲染 children", () => {
    setMe("u-1", "alice");
    render(
      <Can action="update" record={{ ownerId: "u-2" }} schema={ownerSchema}>
        <button>编辑</button>
      </Can>,
    );
    expect(screen.queryByText("编辑")).toBeNull();
  });

  it("无权限时渲染 fallback", () => {
    setMe("u-1", "alice");
    render(
      <Can
        action="update"
        record={{ ownerId: "u-2" }}
        schema={ownerSchema}
        fallback={<span>无权限</span>}
      >
        <button>编辑</button>
      </Can>,
    );
    expect(screen.queryByText("编辑")).toBeNull();
    expect(screen.getByText("无权限")).toBeTruthy();
  });

  it("未传入 fallback 时无权限渲染为空", () => {
    setMe("u-1", "alice");
    const { container } = render(
      <Can action="update" record={{ ownerId: "u-2" }} schema={ownerSchema}>
        <button>编辑</button>
      </Can>,
    );
    expect(container.textContent).toBe("");
  });

  it("未登录用户对所有者策略渲染 fallback", () => {
    setMe(null);
    render(
      <Can
        action="update"
        record={{ ownerId: "u-1" }}
        schema={ownerSchema}
        fallback={<span>请登录</span>}
      >
        <button>编辑</button>
      </Can>,
    );
    expect(screen.getByText("请登录")).toBeTruthy();
    expect(screen.queryByText("编辑")).toBeNull();
  });

  it("schema 为 null 时登录用户渲染 children", () => {
    setMe("u-1");
    render(
      <Can action="read" schema={null}>
        <span>可见</span>
      </Can>,
    );
    expect(screen.getByText("可见")).toBeTruthy();
  });
});
