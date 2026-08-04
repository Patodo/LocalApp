import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { LocalAppError } from "@localapp/sdk";

// Mock the SDK core client
const mutateMock = vi.fn();

vi.mock("../src/client.js", () => ({
  getClient: () => ({
    mutate: (...args: unknown[]) => mutateMock(...args),
  }),
}));

// invalidate is imported from @localapp/sdk — mock it to no-op
vi.mock("@localapp/sdk", async () => {
  const actual = await vi.importActual<typeof import("@localapp/sdk")>("@localapp/sdk");
  return {
    ...actual,
    invalidate: vi.fn(),
  };
});

import { useTransitions } from "../src/hooks/use-transitions.js";
import type { BusinessMetadata } from "../src/permissions.js";

const schema: BusinessMetadata = {
  statusField: "status",
  transitions: [
    { name: "submit", label: "提交", to: "submitted", from: ["draft"] },
    { name: "approve", label: "批准", to: "approved", from: ["submitted"] },
    { name: "cancel", label: "取消", to: "cancelled", from: ["draft", "submitted"] },
  ],
};

beforeEach(() => {
  mutateMock.mockReset();
});

describe("useTransitions — 本地计算可用动作", () => {
  it("根据 record 当前状态过滤 transitions（不发网络请求）", async () => {
    const { result } = renderHook(() => useTransitions("leaves", { id: 1, status: "draft" }, schema));

    await waitFor(() => expect(result.current.transitions).toHaveLength(2));
    const names = result.current.transitions.map((t) => t.name).sort();
    expect(names).toEqual(["cancel", "submit"]);
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("record 状态变化时重新计算", async () => {
    const { result, rerender } = renderHook(
      ({ record }) => useTransitions("leaves", record, schema),
      { initialProps: { record: { id: 1, status: "draft" } } },
    );

    await waitFor(() => expect(result.current.transitions.map((t) => t.name).sort()).toEqual(["cancel", "submit"]));

    rerender({ record: { id: 1, status: "submitted" } });
    expect(result.current.transitions.map((t) => t.name).sort()).toEqual(["approve", "cancel"]);

    rerender({ record: { id: 1, status: "approved" } });
    expect(result.current.transitions).toHaveLength(0);
  });

  it("record 为 null 时 transitions 为空", async () => {
    const { result } = renderHook(() => useTransitions("leaves", null, schema));
    expect(result.current.transitions).toEqual([]);
  });

  it("schema 未声明 transitions 时返回空数组", async () => {
    const noTransSchema: BusinessMetadata = { statusField: "status" };
    const { result } = renderHook(() => useTransitions("leaves", { id: 1, status: "draft" }, noTransSchema));
    expect(result.current.transitions).toEqual([]);
  });
});

describe("useTransitions — transition()", () => {
  it("执行 transition 发送 mutate 到 $<resource>.<name> 并附带 id", async () => {
    mutateMock.mockResolvedValue({ changes: 1 });
    const { result } = renderHook(() => useTransitions("leaves", { id: 7, status: "draft" }, schema));
    await waitFor(() => expect(result.current.transitions.length).toBeGreaterThan(0));

    let captured: unknown;
    await act(async () => {
      captured = await result.current.transition("submit");
    });

    expect(mutateMock).toHaveBeenCalledWith("$leaves.submit", { id: 7 });
    expect(captured).toEqual({ changes: 1 });
  });

  it("支持传入 payload，与 id 合并发送", async () => {
    mutateMock.mockResolvedValue({ changes: 1 });
    const { result } = renderHook(() => useTransitions("leaves", { id: 7, status: "submitted" }, schema));
    await waitFor(() => expect(result.current.transitions.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.transition("approve", { comment: "ok" });
    });

    expect(mutateMock).toHaveBeenCalledWith("$leaves.approve", { id: 7, comment: "ok" });
  });

  it("成功后触发 onSuccess 回调", async () => {
    const mutationResult = { changes: 1 };
    mutateMock.mockResolvedValue(mutationResult);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useTransitions("leaves", { id: 7, status: "draft" }, schema, { onSuccess }),
    );
    await waitFor(() => expect(result.current.transitions.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.transition("submit");
    });

    expect(onSuccess).toHaveBeenCalledWith(mutationResult);
  });

  it("错误抛出并设置 LocalAppError", async () => {
    mutateMock.mockRejectedValue(new LocalAppError("State not allowed", 400));
    const { result } = renderHook(() => useTransitions("leaves", { id: 7, status: "draft" }, schema));
    await waitFor(() => expect(result.current.transitions.length).toBeGreaterThan(0));

    await act(async () => {
      try {
        await result.current.transition("submit");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(LocalAppError);
      }
    });

    expect(result.current.error?.status).toBe(400);
  });

  it("record 没有 id 时 transition 抛出错误", async () => {
    const { result } = renderHook(() => useTransitions("leaves", { status: "draft" }, schema));

    await act(async () => {
      try {
        await result.current.transition("submit");
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(LocalAppError);
      }
    });
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
