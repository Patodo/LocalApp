export const LOCAL_SHELL_SCRIPT = String.raw`
(() => {
  "use strict";

  const localUser = { id: "local-user", name: "Local User", role: "owner" };
  let activeConfirm = null;
  let focusBeforeDialog = null;
  let focusBeforeAi = null;

  function payloadObject(payload) {
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  }

  function respond(id, ok, result, error) {
    window.dispatchEvent(new MessageEvent("message", {
      data: Object.assign(
        { type: "localapp:platform_response", id, ok },
        ok ? { result } : { error },
      ),
      origin: window.location.origin,
    }));
  }

  function shellElement(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error("Local Platform Shell is unavailable");
    return element;
  }

  function downloadFile(payload) {
    const body = payloadObject(payload);
    const filename =
      typeof body.filename === "string" && body.filename.trim()
        ? body.filename
        : "download";
    const mimeType =
      typeof body.mimeType === "string"
        ? body.mimeType
        : "application/octet-stream";
    const data = body.data;
    const blob =
      data instanceof Blob
        ? data
        : data instanceof ArrayBuffer
          ? new Blob([data], { type: mimeType })
          : new Blob(
              [typeof data === "string" ? data : JSON.stringify(data ?? "")],
              { type: mimeType },
            );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function resolveConfirm(confirmed) {
    if (!activeConfirm) return;
    const request = activeConfirm;
    activeConfirm = null;
    const dialog = shellElement("[data-localapp-local-confirm]");
    dialog.hidden = true;
    shellElement("[data-localapp-local-confirm-title]").textContent = "";
    shellElement("[data-localapp-local-confirm-message]").textContent = "";
    respond(request.id, true, confirmed);
    if (focusBeforeDialog && typeof focusBeforeDialog.focus === "function") {
      focusBeforeDialog.focus();
    }
    focusBeforeDialog = null;
  }

  function showConfirm(message) {
    if (activeConfirm) {
      respond(
        activeConfirm.id,
        false,
        undefined,
        "Confirmation was replaced by a newer request",
      );
    }
    const body = payloadObject(message.payload);
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title
        : "Confirm action";
    const dialog = shellElement("[data-localapp-local-confirm]");
    const confirmButton = shellElement("[data-localapp-local-confirm-accept]");
    const cancelButton = shellElement("[data-localapp-local-confirm-cancel]");
    shellElement("[data-localapp-local-confirm-title]").textContent = title;
    shellElement("[data-localapp-local-confirm-message]").textContent =
      typeof body.message === "string" ? body.message : "";
    confirmButton.textContent =
      typeof body.confirmText === "string" && body.confirmText.trim()
        ? body.confirmText
        : "Confirm";
    cancelButton.textContent =
      typeof body.cancelText === "string" && body.cancelText.trim()
        ? body.cancelText
        : "Cancel";
    confirmButton.dataset.tone = body.tone === "danger" ? "danger" : "default";
    activeConfirm = { id: message.id };
    focusBeforeDialog = document.activeElement;
    dialog.hidden = false;
    cancelButton.focus();
  }

  function setAiOpen(open) {
    const overlay = shellElement("[data-localapp-local-ai]");
    if (open) {
      focusBeforeAi = document.activeElement;
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      shellElement("[data-localapp-local-ai-close]").focus();
      return;
    }
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    if (focusBeforeAi && typeof focusBeforeAi.focus === "function") {
      focusBeforeAi.focus();
    }
    focusBeforeAi = null;
  }

  async function handlePlatformRequest(message) {
    if (
      !message ||
      message.type !== "localapp:platform_request" ||
      typeof message.id !== "string" ||
      typeof message.capability !== "string"
    ) {
      return;
    }
    try {
      switch (message.capability) {
        case "getCurrentUser":
          respond(message.id, true, localUser);
          return;
        case "getServerTime": {
          const response = await fetch("/api/time", { credentials: "include" });
          const body = await response.json();
          if (!response.ok || !body.success) {
            throw new Error(body.error || "Server time request failed: " + response.status);
          }
          respond(message.id, true, body.data);
          return;
        }
        case "copyText": {
          const body = payloadObject(message.payload);
          await navigator.clipboard.writeText(
            typeof body.text === "string" ? body.text : "",
          );
          respond(message.id, true, { success: true });
          return;
        }
        case "downloadFile":
          downloadFile(message.payload);
          respond(message.id, true, { success: true });
          return;
        case "confirm":
          showConfirm(message);
          return;
        case "openRoute": {
          const body = payloadObject(message.payload);
          const href = typeof body.href === "string" ? body.href : "";
          if (!href) throw new Error("openRoute requires href");
          if (/^https?:\/\//i.test(href)) {
            window.open(href, "_blank", "noopener,noreferrer");
          } else {
            const target = new URL(href, window.location.href);
            if (target.origin !== window.location.origin) {
              throw new Error("openRoute only supports local or HTTP(S) routes");
            }
            window.history.pushState(window.history.state, "", target);
            window.dispatchEvent(new PopStateEvent("popstate", {
              state: window.history.state,
            }));
          }
          respond(message.id, true, { success: true });
          return;
        }
        case "auth.login":
          respond(message.id, true, {
            success: true,
            authenticated: true,
            user: localUser,
          });
          return;
        case "ai.open":
          setAiOpen(true);
          respond(message.id, true, { success: true });
          return;
        case "ai.close":
          setAiOpen(false);
          respond(message.id, true, { success: true });
          return;
        case "ai.toggle": {
          const overlay = shellElement("[data-localapp-local-ai]");
          setAiOpen(overlay.hidden);
          respond(message.id, true, { success: true });
          return;
        }
        default:
          throw new Error("Unknown platform capability: " + message.capability);
      }
    } catch (error) {
      respond(
        message.id,
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  window.addEventListener("localapp:platform_request", (event) => {
    event.preventDefault();
    void handlePlatformRequest(event.detail);
  });
  window.addEventListener("message", (event) => {
    if (event.origin && event.origin !== window.location.origin) return;
    void handlePlatformRequest(event.data);
  });
  document.addEventListener("DOMContentLoaded", () => {
    shellElement("[data-localapp-local-confirm-cancel]").addEventListener(
      "click",
      () => resolveConfirm(false),
    );
    shellElement("[data-localapp-local-confirm-accept]").addEventListener(
      "click",
      () => resolveConfirm(true),
    );
    shellElement("[data-localapp-local-confirm]").addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          resolveConfirm(false);
        }
      },
    );
    shellElement("[data-localapp-local-ai-close]").addEventListener(
      "click",
      () => setAiOpen(false),
    );
  });
})();
`;

export const LOCAL_SHELL_STYLES = String.raw`
:root {
  --localapp-shell-border: #d1d5db;
  --localapp-shell-surface: #ffffff;
  --localapp-shell-muted: #f3f4f6;
  --localapp-shell-text: #111827;
  --localapp-shell-subtle: #4b5563;
  --localapp-shell-accent: #0f766e;
  --localapp-shell-danger: #b91c1c;
}

[data-localapp-local-shell] {
  align-items: center;
  background: var(--localapp-shell-surface);
  border-bottom: 1px solid var(--localapp-shell-border);
  box-sizing: border-box;
  color: var(--localapp-shell-text);
  display: flex;
  font: 14px/1.4 system-ui, sans-serif;
  gap: 12px;
  min-height: 48px;
  padding: 8px 16px;
}

[data-localapp-local-shell] span {
  color: var(--localapp-shell-subtle);
  margin-left: auto;
}

[data-localapp-local-confirm][hidden],
[data-localapp-local-ai][hidden] {
  display: none !important;
}

[data-localapp-local-confirm] {
  align-items: center;
  background: rgb(17 24 39 / 45%);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 16px;
  position: fixed;
  z-index: 2147483647;
}

.localapp-local-confirm-panel {
  background: var(--localapp-shell-surface);
  border: 1px solid var(--localapp-shell-border);
  border-radius: 8px;
  box-shadow: 0 18px 50px rgb(17 24 39 / 22%);
  box-sizing: border-box;
  color: var(--localapp-shell-text);
  font: 14px/1.5 system-ui, sans-serif;
  max-width: 420px;
  padding: 20px;
  width: 100%;
}

.localapp-local-confirm-panel h2 {
  font-size: 16px;
  margin: 0;
}

.localapp-local-confirm-panel p {
  color: var(--localapp-shell-subtle);
  margin: 8px 0 0;
  white-space: pre-wrap;
}

.localapp-local-confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 20px;
}

.localapp-local-button {
  background: var(--localapp-shell-surface);
  border: 1px solid var(--localapp-shell-border);
  border-radius: 6px;
  color: var(--localapp-shell-text);
  cursor: pointer;
  font: 600 14px/1 system-ui, sans-serif;
  min-height: 36px;
  padding: 0 14px;
}

.localapp-local-button:focus-visible {
  outline: 3px solid rgb(15 118 110 / 35%);
  outline-offset: 2px;
}

[data-localapp-local-confirm-accept] {
  background: var(--localapp-shell-accent);
  border-color: var(--localapp-shell-accent);
  color: #ffffff;
}

[data-localapp-local-confirm-accept][data-tone="danger"] {
  background: var(--localapp-shell-danger);
  border-color: var(--localapp-shell-danger);
}

[data-localapp-local-ai] {
  background: var(--localapp-shell-surface);
  border-left: 1px solid var(--localapp-shell-border);
  box-shadow: -12px 0 32px rgb(17 24 39 / 12%);
  box-sizing: border-box;
  color: var(--localapp-shell-text);
  font: 14px/1.5 system-ui, sans-serif;
  height: calc(100vh - 48px);
  max-width: min(380px, 92vw);
  padding: 16px;
  position: fixed;
  right: 0;
  top: 48px;
  width: 380px;
  z-index: 2147483646;
}

.localapp-local-ai-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.localapp-local-ai-header h2 {
  font-size: 16px;
  margin: 0;
}

.localapp-local-ai-close {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: var(--localapp-shell-subtle);
  cursor: pointer;
  display: inline-flex;
  height: 36px;
  justify-content: center;
  width: 36px;
}

.localapp-local-ai-close svg {
  height: 20px;
  width: 20px;
}

.localapp-local-ai-close:focus-visible {
  outline: 3px solid rgb(15 118 110 / 35%);
  outline-offset: 2px;
}
`;
