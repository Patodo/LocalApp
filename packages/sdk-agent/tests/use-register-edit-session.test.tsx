import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React, { act } from "react";
import {
  registerEditSessionForShell,
  useRegisterEditSession,
  type PlatformEditSessionInput,
} from "../src/use-register-edit-session.js";
import { setPlatformEditSessionRegistry } from "../src/native-registry.js";

describe("useRegisterEditSession", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setPlatformEditSessionRegistry(null);
    vi.restoreAllMocks();
  });

  it("registers the app edit session into the same-window native registry", () => {
    const unregister = vi.fn();
    const registerEditSession = vi.fn().mockReturnValue(unregister);
    const onSave = vi.fn();
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    setPlatformEditSessionRegistry({ registerEditSession });

    const cleanup = registerEditSessionForShell({
      canSave: true,
      canUndo: false,
      canRedo: true,
      busy: false,
      onSave,
      onUndo,
      onRedo,
    });

    expect(registerEditSession).toHaveBeenCalledTimes(1);
    const [session] = registerEditSession.mock.calls[0];
    expect(session).toMatchObject({
      canSave: true,
      canUndo: false,
      canRedo: true,
      busy: false,
    });

    session.onSave();
    session.onUndo();
    session.onRedo();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);

    cleanup?.();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("updates the shell edit session when state changes", () => {
    const cleanupFirst = vi.fn();
    const cleanupSecond = vi.fn();
    const registerEditSession = vi
      .fn()
      .mockReturnValueOnce(cleanupFirst)
      .mockReturnValueOnce(cleanupSecond);
    setPlatformEditSessionRegistry({ registerEditSession });

    function Editor(props: PlatformEditSessionInput) {
      useRegisterEditSession(props);
      return null;
    }

    const callbacks = {
      onSave: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    };

    act(() => {
      root.render(React.createElement(Editor, {
        canSave: true,
        canUndo: false,
        canRedo: false,
        busy: false,
        ...callbacks,
      }));
    });
    act(() => {
      root.render(React.createElement(Editor, {
        canSave: true,
        canUndo: true,
        canRedo: false,
        busy: false,
        ...callbacks,
      }));
    });

    expect(registerEditSession).toHaveBeenCalledTimes(2);
    expect(registerEditSession.mock.calls[0][0].canUndo).toBe(false);
    expect(registerEditSession.mock.calls[1][0].canUndo).toBe(true);
    expect(cleanupFirst).toHaveBeenCalledTimes(1);
    expect(cleanupSecond).not.toHaveBeenCalled();
  });

  it("silently skips registration outside a LocalApp shell", () => {
    const cleanup = registerEditSessionForShell({
      canSave: true,
      canUndo: true,
      canRedo: true,
      onSave: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    });

    expect(cleanup).toBeUndefined();
  });
});
