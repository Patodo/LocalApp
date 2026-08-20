// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditingAwarenessOverlay, type EditingOverlayPeer } from "./editing-awareness-overlay";

describe("EditingAwarenessOverlay", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws a pointer-transparent mask over an exact app field and labels the editor", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-localapp-app-area")) return rect(0, 40, 800, 600);
      if (this.dataset.localappEditField === "title") return rect(100, 140, 320, 48);
      return rect(0, 0, 0, 0);
    });
    const peer: EditingOverlayPeer = {
      clientId: "remote-1",
      user: { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null, color: "#2563eb" },
      editing: { surfaceId: "proposal:1", fieldId: "title", label: "标题" },
      overlay: true,
    };

    render(
      <div className="relative" data-localapp-app-area>
        <div data-localapp-app-root>
          <section data-localapp-edit-surface="proposal:1">
            <input data-localapp-edit-field="title" />
          </section>
        </div>
        <EditingAwarenessOverlay peers={[peer]} />
      </div>,
    );
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    const mask = await waitFor(() => document.querySelector<HTMLElement>("[data-localapp-editing-mask]"));
    expect(mask).not.toBeNull();
    expect(mask?.style.left).toBe("100px");
    expect(mask?.style.top).toBe("100px");
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(document.querySelector("[data-localapp-editing-awareness-overlay]")?.className).toContain("pointer-events-none");
  });

  it("does not resolve arbitrary selectors outside the app root", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    render(
      <div data-localapp-app-area>
        <div data-localapp-app-root />
        <div data-localapp-edit-surface="outside" />
        <EditingAwarenessOverlay peers={[{
          clientId: "remote-2",
          user: { id: "eve", name: "eve", displayName: null, avatarUrl: null, color: "#ff0000" },
          editing: { surfaceId: "outside" },
        }]} />
      </div>,
    );
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(document.querySelector("[data-localapp-editing-mask]")).toBeNull();
  });
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
}
