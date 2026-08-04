import { describe, expect, it, vi } from "vitest";
import { clearIssueCommentDeepLinkUrl, copyIssueUrl, readIssueCommentDeepLinkId, readIssueDeepLinkId, readIssueDeepLinkNumber, readIssuesWorkspaceOpen, updateIssueCommentDeepLinkUrl, updateIssueDeepLinkUrl, updateIssueNumberDeepLinkUrl, updateIssuesWorkspaceUrl } from "./issue-deep-link";

describe("Issue deep-link URL state", () => {
  it("accepts only positive integer Issue IDs", () => {
    expect(readIssueDeepLinkId(new URL("https://localapp.test/app?localappIssueId=12"))).toBe(12);
    for (const value of ["", "0", "-1", "1.5", "12x", "Infinity"]) {
      expect(readIssueDeepLinkId(new URL(`https://localapp.test/app?localappIssueId=${encodeURIComponent(value)}`))).toBeNull();
    }
  });

  it("sets and clears only the reserved parameter", () => {
    const source = new URL("https://localapp.test/owner/app?tab=history&localappIssueId=3&localappIssueCommentId=8#stage-2");
    expect(updateIssueDeepLinkUrl(source, 12).href).toBe("https://localapp.test/owner/app?tab=history&localappIssueId=12&localappIssues=1#stage-2");
    expect(updateIssueDeepLinkUrl(source, null).href).toBe("https://localapp.test/owner/app?tab=history&localappIssues=1#stage-2");
    expect(source.href).toBe("https://localapp.test/owner/app?tab=history&localappIssueId=3&localappIssueCommentId=8#stage-2");
  });

  it("keeps public Issue numbers distinct and canonicalizes them to ids", () => {
    const numbered = updateIssueNumberDeepLinkUrl(new URL("https://localapp.test/app?tab=history&localappIssueId=9"), 42);
    expect(numbered.href).toBe("https://localapp.test/app?tab=history&localappIssues=1&localappIssueNumber=42");
    expect(readIssueDeepLinkNumber(numbered)).toBe(42);
    expect(readIssueDeepLinkId(numbered)).toBeNull();
    expect(updateIssueDeepLinkUrl(numbered, 99).href).toBe("https://localapp.test/app?tab=history&localappIssues=1&localappIssueId=99");
  });

  it("creates and reads comment permalinks without replacing app URL state", () => {
    const source = new URL("https://localapp.test/owner/app?tab=history&localappIssueId=3#stage-2");
    const permalink = updateIssueCommentDeepLinkUrl(source, 12, 6);
    expect(permalink.href).toBe("https://localapp.test/owner/app?tab=history&localappIssueId=12&localappIssues=1&localappIssueCommentId=6#stage-2");
    expect(readIssueCommentDeepLinkId(permalink)).toBe(6);
    for (const value of ["", "0", "-1", "1.5", "6x"]) {
      expect(readIssueCommentDeepLinkId(new URL(`https://localapp.test/app?localappIssueCommentId=${encodeURIComponent(value)}`))).toBeNull();
    }
  });

  it("clears only a matching deleted comment deep link", () => {
    const source = new URL("https://localapp.test/app?tab=history&localappIssues=1&localappIssueId=12&localappIssueCommentId=6");
    expect(clearIssueCommentDeepLinkUrl(source, 7).href).toBe(source.href);
    expect(clearIssueCommentDeepLinkUrl(source, 6).href).toBe("https://localapp.test/app?tab=history&localappIssues=1&localappIssueId=12");
  });

  it("opens and closes the workspace without discarding list context", () => {
    const source = new URL("https://localapp.test/app?tab=history&localappIssueQ=upload&localappIssueId=12&localappIssueCommentId=6#stage-2");
    const opened = updateIssuesWorkspaceUrl(source, true);
    expect(readIssuesWorkspaceOpen(opened)).toBe(true);
    const closed = updateIssuesWorkspaceUrl(opened, false);
    expect(readIssuesWorkspaceOpen(closed)).toBe(false);
    expect(closed.href).toBe("https://localapp.test/app?tab=history&localappIssueQ=upload#stage-2");
  });

  it("falls back when the Clipboard API does not settle", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => new Promise<void>(() => {}));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });

    const copying = copyIssueUrl("https://localapp.test/app?localappIssueId=12", 20);
    await vi.advanceTimersByTimeAsync(20);
    await copying;

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    vi.useRealTimers();
  });
});
