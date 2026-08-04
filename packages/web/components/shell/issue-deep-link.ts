export const ISSUE_DEEP_LINK_PARAM = "localappIssueId";
export const ISSUE_NUMBER_DEEP_LINK_PARAM = "localappIssueNumber";
export const ISSUE_COMMENT_DEEP_LINK_PARAM = "localappIssueCommentId";
export const ISSUES_WORKSPACE_PARAM = "localappIssues";

function readPositiveIntegerParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function readIssueDeepLinkId(url: URL): number | null {
  return readPositiveIntegerParam(url, ISSUE_DEEP_LINK_PARAM);
}

export function readIssueDeepLinkNumber(url: URL): number | null {
  return readPositiveIntegerParam(url, ISSUE_NUMBER_DEEP_LINK_PARAM);
}

export function readIssueCommentDeepLinkId(url: URL): number | null {
  return readPositiveIntegerParam(url, ISSUE_COMMENT_DEEP_LINK_PARAM);
}

export function readIssuesWorkspaceOpen(url: URL): boolean {
  return url.searchParams.get(ISSUES_WORKSPACE_PARAM) === "1" || readIssueDeepLinkId(url) !== null || readIssueDeepLinkNumber(url) !== null;
}

export function updateIssuesWorkspaceUrl(source: URL, open: boolean): URL {
  const url = new URL(source.href);
  if (open) url.searchParams.set(ISSUES_WORKSPACE_PARAM, "1");
  else {
    url.searchParams.delete(ISSUES_WORKSPACE_PARAM);
    url.searchParams.delete(ISSUE_DEEP_LINK_PARAM);
    url.searchParams.delete(ISSUE_NUMBER_DEEP_LINK_PARAM);
    url.searchParams.delete(ISSUE_COMMENT_DEEP_LINK_PARAM);
  }
  return url;
}

export function updateIssueDeepLinkUrl(source: URL, issueId: number | null): URL {
  const url = new URL(source.href);
  url.searchParams.set(ISSUES_WORKSPACE_PARAM, "1");
  if (issueId === null) url.searchParams.delete(ISSUE_DEEP_LINK_PARAM);
  else url.searchParams.set(ISSUE_DEEP_LINK_PARAM, String(issueId));
  url.searchParams.delete(ISSUE_NUMBER_DEEP_LINK_PARAM);
  url.searchParams.delete(ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}

export function updateIssueNumberDeepLinkUrl(source: URL, issueNumber: number): URL {
  const url = new URL(source.href);
  url.searchParams.set(ISSUES_WORKSPACE_PARAM, "1");
  url.searchParams.delete(ISSUE_DEEP_LINK_PARAM);
  url.searchParams.set(ISSUE_NUMBER_DEEP_LINK_PARAM, String(issueNumber));
  url.searchParams.delete(ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}

export function updateIssueCommentDeepLinkUrl(source: URL, issueId: number, commentId: number): URL {
  const url = new URL(source.href);
  url.searchParams.set(ISSUES_WORKSPACE_PARAM, "1");
  url.searchParams.set(ISSUE_DEEP_LINK_PARAM, String(issueId));
  url.searchParams.delete(ISSUE_NUMBER_DEEP_LINK_PARAM);
  url.searchParams.set(ISSUE_COMMENT_DEEP_LINK_PARAM, String(commentId));
  return url;
}

export function clearIssueCommentDeepLinkUrl(source: URL, commentId?: number): URL {
  const url = new URL(source.href);
  if (commentId === undefined || readIssueCommentDeepLinkId(url) === commentId) url.searchParams.delete(ISSUE_COMMENT_DEEP_LINK_PARAM);
  return url;
}

export async function copyIssueUrl(text: string, timeoutMs = 500): Promise<void> {
  const legacyCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = typeof document.execCommand === "function" && document.execCommand("copy");
    textarea.remove();
    return copied;
  };
  if (legacyCopy()) return;
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard write failed");
  await Promise.race([
    navigator.clipboard.writeText(text),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Clipboard write timed out")), timeoutMs)),
  ]);
}
