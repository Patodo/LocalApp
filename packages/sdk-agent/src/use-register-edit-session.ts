import { useEffect } from "react";
import { getPlatformEditSessionRegistry } from "./native-registry.js";
import type { PlatformEditSession } from "./native-registry.js";

export type PlatformEditSessionInput = PlatformEditSession | null | undefined;

export function registerEditSessionForShell(session: PlatformEditSessionInput): void | (() => void) {
  if (!session) return;

  const registry = getPlatformEditSessionRegistry();
  if (!registry) return;

  return registry.registerEditSession({
    canSave: session.canSave,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    busy: session.busy ?? false,
    onSave: session.onSave,
    onUndo: session.onUndo,
    onRedo: session.onRedo,
  });
}

export function useRegisterEditSession(session: PlatformEditSessionInput): void {
  useEffect(() => {
    if (!session) return;
    let cleanup: void | (() => void);
    let stopped = false;
    let attempts = 0;

    const register = () => {
      if (stopped || cleanup) return;
      cleanup = registerEditSessionForShell(session);
      attempts += 1;
      if (!cleanup && attempts < 20) {
        window.setTimeout(register, 50);
      }
    };

    register();
    return () => {
      stopped = true;
      cleanup?.();
    };
  }, [
    session?.canSave,
    session?.canUndo,
    session?.canRedo,
    session?.busy,
    session?.onSave,
    session?.onUndo,
    session?.onRedo,
  ]);
}
