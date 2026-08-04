type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();
let devContextListenerTarget: Window | null = null;

export function subscribe(resource: string, fn: Listener): () => void {
  installDevContextInvalidation();
  if (!listeners.has(resource)) {
    listeners.set(resource, new Set());
  }
  listeners.get(resource)!.add(fn);
  return () => {
    const set = listeners.get(resource);
    if (set) {
      set.delete(fn);
      if (set.size === 0) listeners.delete(resource);
    }
  };
}

export function invalidate(resource: string): void {
  const set = listeners.get(resource);
  if (set) {
    for (const fn of set) fn();
  }
}

function invalidateAll(): void {
  for (const set of listeners.values()) {
    for (const fn of set) fn();
  }
}

function installDevContextInvalidation(): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const eventName = ["localapp", "dev-context-changed"].join(":");
  if (devContextListenerTarget === window) return;
  devContextListenerTarget?.removeEventListener(eventName, invalidateAll);
  devContextListenerTarget = window;
  window.addEventListener(eventName, invalidateAll);
}
