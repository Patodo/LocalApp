import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useUpload } from "@localapp/sdk-react";
import { LocalAppError } from "@localapp/sdk";

describe("useUpload", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("uploads a file successfully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({
        success: true,
        data: { key: "abc123.png", url: "/serve/alice/my-app/api/content/abc123.png" },
      }),
    } as Response);

    const { result } = renderHook(() => useUpload());
    const file = new File(["data"], "photo.png", { type: "image/png" });

    let uploadResult;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult).toEqual({
      key: "abc123.png",
      url: "/serve/alice/my-app/api/content/abc123.png",
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // Verify FormData was used
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].body).toBeInstanceOf(FormData);
  });

  it("sets loading during upload", async () => {
    let resolveUpload: (value: any) => void;
    const uploadPromise = new Promise((resolve) => { resolveUpload = resolve; });
    globalThis.fetch = vi.fn().mockReturnValueOnce(uploadPromise);

    const { result } = renderHook(() => useUpload());
    const file = new File(["data"], "photo.png", { type: "image/png" });

    act(() => {
      result.current.upload(file);
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveUpload!({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ success: true, data: { key: "a.png", url: "/x" } }),
      });
    });

    expect(result.current.loading).toBe(false);
  });

  it("sets error and rejects on server error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    const { result } = renderHook(() => useUpload());
    const file = new File(["data"], "photo.png", { type: "image/png" });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(file);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeInstanceOf(LocalAppError);
    expect((thrown as LocalAppError).status).toBe(401);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error?.status).toBe(401);
  });

  it("handles unsupported file type (400)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, error: "Unsupported file type" }),
    } as Response);

    const { result } = renderHook(() => useUpload());
    const file = new File(["data"], "doc.txt", { type: "text/plain" });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(file);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeInstanceOf(LocalAppError);
    expect((thrown as LocalAppError).message).toBe("Unsupported file type");
    expect((thrown as LocalAppError).status).toBe(400);
    expect(result.current.error?.status).toBe(400);
  });

  it("handles file too large (413)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: () => Promise.resolve({ success: false, error: "File exceeds 10MB limit" }),
    } as Response);

    const { result } = renderHook(() => useUpload());
    const file = new File(["x".repeat(1024)], "big.png", { type: "image/png" });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.upload(file);
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeInstanceOf(LocalAppError);
    expect((thrown as LocalAppError).message).toBe("File exceeds 10MB limit");
    expect((thrown as LocalAppError).status).toBe(413);
    expect(result.current.error?.status).toBe(413);
  });
});
