import { describe, it, expect, vi, afterEach } from "vitest";
import { redirectToLogin } from "@localapp/sdk";

describe("redirectToLogin", () => {
  const originalParent = window.parent;
  const originalLocation = window.location;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the same-page platform shell to open login without navigating away", () => {
    const mockParent = { location: { href: "" } } as unknown as Window;
    const mockLocation = { href: "http://localhost/serve/alice/app/" };
    const request = vi.fn((event: Event) => event.preventDefault());
    delete (window as any).parent;
    (window as any).parent = mockParent;
    delete (window as any).location;
    (window as any).location = mockLocation;
    window.addEventListener("localapp:platform_request", request);

    redirectToLogin();

    expect(request).toHaveBeenCalledOnce();
    expect((request.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      type: "localapp:platform_request",
      capability: "auth.login",
    });
    expect(mockLocation.href).toBe("http://localhost/serve/alice/app/");
    expect(mockParent.location.href).toBe("");

    window.removeEventListener("localapp:platform_request", request);
    (window as any).parent = originalParent;
    (window as any).location = originalLocation;
  });

  it("falls back to the platform home when no shell handles the request", () => {
    const mockLocation = { href: "http://localhost/serve/alice/app/" };
    delete (window as any).parent;
    (window as any).parent = window;
    delete (window as any).location;
    (window as any).location = mockLocation;

    redirectToLogin();

    expect(mockLocation.href).toBe("/");

    (window as any).parent = originalParent;
    (window as any).location = originalLocation;
  });
});
